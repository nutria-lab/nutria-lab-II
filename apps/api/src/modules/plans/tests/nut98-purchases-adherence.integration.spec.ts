import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { Client, Pool } from 'pg';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdherenceController } from '../../adherence/adherence.controller';
import { AdherenceRepository } from '../../adherence/adherence.repository';
import { AdherenceService } from '../../adherence/adherence.service';
import { RecipeValidationService } from '../../plans/recipe-validation.service';
import { PlansController } from '../plans.controller';
import { MealPlanRegenerationService } from '../meal-plan-regeneration.service';
import { MealReplacementService } from '../meal-replacement.service';
import { PlansRepository } from '../plans.repository';
import { PlansService } from '../plans.service';
import { ShoppingListController } from '../../shopping-list/shopping-list.controller';
import { ShoppingListItemKeyPipe } from '../../shopping-list/shopping-list-item-key.pipe';
import { ShoppingListRepository } from '../../shopping-list/shopping-list.repository';
import { ShoppingListService } from '../../shopping-list/shopping-list.service';

// This suite creates and drops a private schema on an explicitly local disposable PostgreSQL.
// It never falls back to DATABASE_URL or contacts a shared database.
const dbUrl = process.env.NUT98_TEST_DATABASE_URL
  ?? process.env.SHOPPING_LIST_TEST_DATABASE_URL
  ?? process.env.ADHERENCE_TEST_DATABASE_URL;
const describeWithDb = dbUrl ? describe : describe.skip;
const weekStart = '2026-10-19';
const weekStartDate = new Date(`${weekStart}T00:00:00.000Z`);
const mondayDate = new Date(`${weekStart}T00:00:00.000Z`);
const baClock = () => new Date('2026-10-20T02:00:00.000Z');
const ownerTokenSecret = 'nut98-disposable-test-secret';

describeWithDb('NUT-98 purchases and adherence cross-flow on isolated PostgreSQL', () => {
  let schema: string;
  let admin: Client;
  let pool: Pool;
  let prisma: PrismaClient;
  let app: INestApplication;
  let baseUrl: string;
  let jwt: JwtService;
  let plans: PlansRepository;
  let previousJwtSecret: string | undefined;
  let jwtSecretChanged = false;

  beforeAll(async () => {
    previousJwtSecret = process.env.JWT_SECRET;

    const parsed = new URL(dbUrl!);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)) {
      throw new Error('NUT-98 cross-flow tests require a disposable local PostgreSQL instance');
    }

    schema = `nut98_flow_${randomBytes(6).toString('hex')}`;
    admin = new Client({ connectionString: dbUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);

    const options = `-c search_path=${schema},public`;
    const migrator = new Client({ connectionString: dbUrl, options });
    await migrator.connect();
    try {
      const migrationsDir = path.resolve(__dirname, '../../../../prisma/migrations');
      for (const name of fs.readdirSync(migrationsDir).sort()) {
        const sqlFile = path.join(migrationsDir, name, 'migration.sql');
        if (!fs.existsSync(sqlFile)) continue;
        await migrator.query('BEGIN');
        try {
          await migrator.query(fs.readFileSync(sqlFile, 'utf8'));
          await migrator.query('COMMIT');
        } catch (error) {
          await migrator.query('ROLLBACK');
          throw new Error(`Failed isolated test migration ${name}: ${(error as Error).message}`);
        }
      }
    } finally {
      await migrator.end();
    }

    pool = new Pool({ connectionString: dbUrl, options });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    await prisma.$connect();

    plans = new PlansRepository(prisma as any);
    const shopping = new ShoppingListService(new ShoppingListRepository(prisma as any));
    const adherence = new AdherenceService(new AdherenceRepository(prisma as any, baClock), baClock);
    const recipeValidation = new RecipeValidationService(
      { findByNormalizedTitles: async () => [] } as any,
      plans,
    );
    const replacementRecipe = await createRecipe('Garbanzos', 'Bowl de garbanzos');
    const replacement = new MealReplacementService(
      plans,
      {} as any,
      { evaluate: async () => ({ result: { compatibleRecipes: [{ recipe: replacementRecipe }] } }) } as any,
      { get: () => undefined } as any,
      { searchAndSelectCandidate: async () => null, trackDownload: async (image: unknown) => image } as any,
      recipeValidation,
    );
    const regeneratedMeal = {
      mealType: 'LUNCH',
      title: 'Sopa nueva de arvejas',
      nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Comida de prueba' },
      recipe: {
        title: 'Sopa nueva de arvejas',
        description: 'Receta de prueba',
        prepMinutes: 15,
        cookMinutes: 20,
        ingredients: [{ name: 'Arvejas', quantity: 250, unit: 'g' }],
        instructions: ['Cocinar las arvejas'],
      },
    };
    const proposalDays = [{
      day: 'MONDAY',
      date: weekStart,
      meals: [regeneratedMeal],
    }];
    const regeneration = new MealPlanRegenerationService(
      plans,
      { get: () => undefined } as any,
      { composeWeeklyProposal: async () => ({
        dto: { weekStart, days: proposalDays },
        comparableDays: proposalDays,
        summary: { stage: 'passed', codes: [], warnings: [] },
      }) } as any,
      { resolveImagesOrDegrade: async (days: unknown) => days, trackNewRecipeImages: async () => undefined } as any,
      recipeValidation,
    );

    if (process.env.JWT_SECRET !== ownerTokenSecret) {
      process.env.JWT_SECRET = ownerTokenSecret;
      jwtSecretChanged = true;
    }
    jwt = new JwtService({ secret: ownerTokenSecret });
    const module = await Test.createTestingModule({
      controllers: [PlansController, ShoppingListController, AdherenceController],
      providers: [
        { provide: PlansService, useValue: {} },
        { provide: MealReplacementService, useValue: replacement },
        { provide: MealPlanRegenerationService, useValue: regeneration },
        { provide: ShoppingListService, useValue: shopping },
        { provide: AdherenceService, useValue: adherence },
        { provide: JwtService, useValue: jwt },
        JwtAuthGuard,
        ShoppingListItemKeyPipe,
      ],
    }).compile();

    app = module.createNestApplication({ logger: false });
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  }, 60000);

  afterAll(async () => {
    const cleanupErrors: string[] = [];
    const attemptCleanup = async (label: string, cleanup: () => unknown) => {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    await attemptCleanup('close Nest app', async () => app?.close());
    await attemptCleanup('disconnect Prisma', async () => prisma?.$disconnect());
    await attemptCleanup('close PostgreSQL pool', async () => pool?.end());
    await attemptCleanup('drop isolated schema', async () => {
      if (admin && schema) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    });
    await attemptCleanup('close PostgreSQL admin client', async () => admin?.end());
    await attemptCleanup('restore JWT_SECRET', () => {
      if (!jwtSecretChanged) return;
      if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousJwtSecret;
    });

    if (cleanupErrors.length > 0) {
      throw new Error(`NUT-98 integration cleanup failed: ${cleanupErrors.join('; ')}`);
    }
  });

  async function createRecipe(ingredient: string, title: string) {
    return prisma.recipe.create({ data: {
      title,
      description: `Synthetic ${title}`,
      prepMinutes: 10,
      cookMinutes: 10,
      ingredients: [{ name: ingredient, quantity: 250, unit: 'g' }],
      instructions: ['Synthetic preparation'],
      nutritionalValues: { calories: 350, protein: 20 },
    } });
  }

  async function fixture(suffix: string, ingredient: string, title: string) {
    const user = await prisma.user.create({ data: {
      email: `nut98-${suffix}-${randomBytes(4).toString('hex')}@example.test`,
      passwordHash: 'synthetic-test-hash',
    } });
    await prisma.nutritionProfile.create({ data: {
      userId: user.id,
      goal: 'MAINTAIN',
      diet: 'ALL',
      excludedIngredients: [],
      cookTimePreference: 'QUICK',
    } });
    const recipe = await createRecipe(ingredient, title);
    const plan = await prisma.mealPlan.create({
      data: {
        userId: user.id,
        startDate: weekStartDate,
        endDate: new Date(weekStartDate.getTime() + 6 * 86_400_000),
        days: { create: [{
          day: 'MONDAY',
          date: mondayDate,
          meals: { create: [{
            mealType: 'LUNCH',
            title,
            recipeId: recipe.id,
            nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: title },
          }] },
        }] },
      },
      include: { days: { include: { meals: true } } },
    });
    return { user, recipe, plan, meal: plan.days[0].meals[0] };
  }

  async function tokenFor(userId: string): Promise<string> {
    return jwt.signAsync({ sub: userId });
  }

  async function request(pathname: string, options: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}) {
    const headers: Record<string, string> = { ...options.headers };
    if (options.token) headers.cookie = `token=${options.token}`;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    return fetch(`${baseUrl}${pathname}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }

  it('keeps the real plan, shopping checks, replacement, adherence and regeneration contracts in one authenticated flow', async () => {
    const owner = await fixture('owner', 'Avena', 'Avena de prueba');
    const peer = await fixture('peer', 'Lentejas', 'Lentejas de otra cuenta');
    const ownerToken = await tokenFor(owner.user.id);
    const peerToken = await tokenFor(peer.user.id);

    expect((await request(`/shopping-list?weekStart=${weekStart}`)).status).toBe(401);
    expect((await request('/shopping-list?weekStart=2026-10-20', { token: ownerToken })).status).toBe(400);

    const ownerListResponse = await request(`/shopping-list?weekStart=${weekStart}`, { token: ownerToken });
    const peerListResponse = await request(`/shopping-list?weekStart=${weekStart}`, { token: peerToken });
    expect(ownerListResponse.status).toBe(200);
    expect(peerListResponse.status).toBe(200);
    const initialList = await ownerListResponse.json();
    const peerList = await peerListResponse.json();
    expect(initialList.plan).toMatchObject({ id: owner.plan.id, version: 1 });
    expect(initialList.items.map((item: any) => item.name)).toEqual(['avena']);
    expect(peerList.plan.id).toBe(peer.plan.id);
    expect(peerList.items.map((item: any) => item.name)).toEqual(['lentejas']);
    expect(JSON.stringify(initialList)).not.toContain(peer.plan.id);

    const oldItemKey = initialList.items[0].key as string;
    const oldPlanUpdatedAt = initialList.plan.updatedAt as string;
    const oldMealUpdatedAt = owner.meal.updatedAt.toISOString();
    const adherenceInput = {
      planId: owner.plan.id,
      mealUpdatedAt: oldMealUpdatedAt,
      status: 'COMPLETED',
    };
    const invalidAdherence = await request(`/adherence/meals/${owner.meal.id}`, {
      method: 'PUT',
      token: ownerToken,
      body: { ...adherenceInput, userId: peer.user.id },
    });
    expect(invalidAdherence.status).toBe(400);

    const putStatus = await request(`/adherence/meals/${owner.meal.id}`, {
      method: 'PUT', token: ownerToken, body: adherenceInput,
    });
    expect(putStatus.status).toBe(200);
    expect(await putStatus.json()).toMatchObject({ plannedMealId: owner.meal.id, status: 'COMPLETED' });

    const adherenceBefore = await request(`/adherence?weekStart=${weekStart}`, { token: ownerToken });
    const logged = await adherenceBefore.json();
    expect(logged).toMatchObject({
      timezone: 'America/Argentina/Buenos_Aires',
      today: '2026-10-19',
      plan: { id: owner.plan.id, version: 1 },
      summary: { plannedMeals: 1, completedMeals: 1, notLoggedMeals: 0 },
    });
    expect(logged.days[0].date).toBe(weekStart);
    expect(logged.days[0].meals[0]).toMatchObject({ plannedMealId: owner.meal.id, status: 'COMPLETED' });

    const checkBody = { planId: owner.plan.id, planUpdatedAt: oldPlanUpdatedAt, checked: true };
    const checked = await request(`/shopping-list/items/${oldItemKey}`, {
      method: 'PATCH', token: ownerToken, body: checkBody,
    });
    expect(checked.status).toBe(200);
    await request(`/shopping-list/items/${oldItemKey}`, { method: 'PATCH', token: ownerToken, body: checkBody });
    const checkedList = await request(`/shopping-list?weekStart=${weekStart}`, { token: ownerToken });
    expect((await checkedList.json()).items[0].checked).toBe(true);

    const foreignReplace = await request(`/meal-plans/${peer.plan.id}/meals/${peer.meal.id}/replace`, {
      method: 'POST',
      token: ownerToken,
      headers: { 'idempotency-key': '11111111-1111-4111-8111-111111111111' },
      body: {},
    });
    const absentReplace = await request(`/meal-plans/77777777-7777-4777-8777-777777777777/meals/${peer.meal.id}/replace`, {
      method: 'POST',
      token: ownerToken,
      headers: { 'idempotency-key': '22222222-2222-4222-8222-222222222222' },
      body: {},
    });
    expect(foreignReplace.status).toBe(404);
    expect(await foreignReplace.json()).toEqual(await absentReplace.json());

    const replacement = await request(`/meal-plans/${owner.plan.id}/meals/${owner.meal.id}/replace`, {
      method: 'POST',
      token: ownerToken,
      headers: { 'idempotency-key': '33333333-3333-4333-8333-333333333333' },
      body: {},
    });
    expect(replacement.status).toBe(200);
    expect(await replacement.json()).toMatchObject({ planId: owner.plan.id, version: 1 });

    const staleCheck = await request(`/shopping-list/items/${oldItemKey}`, {
      method: 'PATCH', token: ownerToken, body: checkBody,
    });
    expect(staleCheck.status).toBe(409);
    const staleAdherence = await request(`/adherence/meals/${owner.meal.id}`, {
      method: 'PUT', token: ownerToken, body: adherenceInput,
    });
    expect(staleAdherence.status).toBe(409);

    const afterReplaceListResponse = await request(`/shopping-list?weekStart=${weekStart}`, { token: ownerToken });
    const afterReplaceList = await afterReplaceListResponse.json();
    expect(afterReplaceList.plan).toMatchObject({ id: owner.plan.id, version: 1 });
    expect(afterReplaceList.items.map((item: any) => item.name)).toEqual(['garbanzos']);
    expect(afterReplaceList.items[0].key).not.toBe(oldItemKey);
    expect(afterReplaceList.items[0].checked).toBe(false);

    const afterReplaceAdherence = await request(`/adherence?weekStart=${weekStart}`, { token: ownerToken });
    const staleSnapshot = await afterReplaceAdherence.json();
    expect(staleSnapshot.summary).toMatchObject({ plannedMeals: 1, completedMeals: 0, notLoggedMeals: 1 });
    expect(staleSnapshot.days[0].meals[0]).toMatchObject({ plannedMealId: owner.meal.id, status: 'NOT_LOGGED' });

    const foreignRegeneration = await request(`/meal-plans/${peer.plan.id}/regenerate`, {
      method: 'POST',
      token: ownerToken,
      headers: { 'idempotency-key': '44444444-4444-4444-8444-444444444444' },
      body: { reason: 'USER_REQUESTED' },
    });
    const absentRegeneration = await request('/meal-plans/77777777-7777-4777-8777-777777777777/regenerate', {
      method: 'POST',
      token: ownerToken,
      headers: { 'idempotency-key': '55555555-5555-4555-8555-555555555555' },
      body: { reason: 'USER_REQUESTED' },
    });
    expect(foreignRegeneration.status).toBe(404);
    expect(await foreignRegeneration.json()).toEqual(await absentRegeneration.json());

    const regenerated = await request(`/meal-plans/${owner.plan.id}/regenerate`, {
      method: 'POST',
      token: ownerToken,
      headers: { 'idempotency-key': '66666666-6666-4666-8666-666666666666' },
      body: { reason: 'USER_REQUESTED' },
    });
    expect(regenerated.status).toBe(201);
    const newPlan = await regenerated.json();
    expect(newPlan).toMatchObject({ version: 2, isCurrent: true, supersedesId: owner.plan.id });

    const currentListResponse = await request(`/shopping-list?weekStart=${weekStart}`, { token: ownerToken });
    const currentList = await currentListResponse.json();
    expect(currentList.plan).toMatchObject({ id: newPlan.id, version: 2 });
    expect(currentList.items.map((item: any) => item.name)).toEqual(['arvejas']);
    expect(currentList.items[0].checked).toBe(false);

    const currentAdherenceResponse = await request(`/adherence?weekStart=${weekStart}`, { token: ownerToken });
    const currentAdherence = await currentAdherenceResponse.json();
    expect(currentAdherence.plan).toMatchObject({ id: newPlan.id, version: 2 });
    expect(currentAdherence.days[0].meals[0].plannedMealId).not.toBe(owner.meal.id);
    expect(currentAdherence.days[0].meals[0].status).toBe('NOT_LOGGED');
    expect(currentAdherence.summary).toMatchObject({ plannedMeals: 1, completedMeals: 0, notLoggedMeals: 1 });

    const oldVersionRegeneration = await request(`/meal-plans/${owner.plan.id}/regenerate`, {
      method: 'POST',
      token: ownerToken,
      headers: { 'idempotency-key': '77777777-7777-4777-8777-777777777777' },
      body: { reason: 'USER_REQUESTED' },
    });
    expect(oldVersionRegeneration.status).toBe(409);
  }, 60000);
});
