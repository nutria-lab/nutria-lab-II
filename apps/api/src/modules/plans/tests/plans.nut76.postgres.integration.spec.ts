import { randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, DayOfWeek, MealType } from '@/generated/prisma/client';
import { Client, Pool } from 'pg';
import { PlansRepository } from '../plans.repository';
import { PlansService } from '../plans.service';

// This suite intentionally reads only NUT76_TEST_DATABASE_URL. The caller provisions the
// disposable local database and a schema containing the complete migration history.
const dbUrl = process.env.NUT76_TEST_DATABASE_URL?.trim();
const describeWithDb = dbUrl ? describe : describe.skip;
const weekStartStr = '2026-09-14';
const weekStart = new Date(`${weekStartStr}T00:00:00.000Z`);
const mealOrder = [MealType.BREAKFAST, MealType.LUNCH, MealType.SNACK, MealType.DINNER];
const dayOrder = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
  DayOfWeek.SUNDAY,
];

function assertSafeDatabaseUrl(value: string): { schema: string; parsed: URL } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('NUT76_TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('NUT76_TEST_DATABASE_URL must use PostgreSQL.');
  }
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname.toLowerCase())) {
    throw new Error('NUT76_TEST_DATABASE_URL must point to localhost, 127.0.0.1, or ::1.');
  }
  if (!parsed.port || parsed.port === '5432') {
    throw new Error('NUT76_TEST_DATABASE_URL must use an explicit temporary port other than 5432.');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database.startsWith('nut76_')) {
    throw new Error('NUT76_TEST_DATABASE_URL must name a dedicated temporary NUT-76 database.');
  }
  const schema = parsed.searchParams.get('schema');
  if (!schema || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema) || ['public', 'information_schema'].includes(schema)) {
    throw new Error('NUT76_TEST_DATABASE_URL must name a dedicated temporary schema in its schema parameter.');
  }
  return { schema, parsed };
}

describe('NUT-76 local database URL guard', () => {
  it.each([
    'postgresql://test:test@db.example.invalid:5432/nutria?schema=nut76_test',
    'postgresql://test:test@127.0.0.1:5432/nut76_test?schema=nut76_test',
    'postgresql://test:test@127.0.0.1/nutria?schema=nut76_test',
    'postgresql://test:test@127.0.0.1:5433/shared_db?schema=nut76_test',
    'not a database URL',
  ])('rejects a non-disposable or malformed URL', url => {
    expect(() => assertSafeDatabaseUrl(url)).toThrow(/NUT76_TEST_DATABASE_URL/);
  });

  it.each([
    'postgresql://test:test@localhost:5433/nut76_local?schema=nut76_test',
    'postgresql://test:test@127.0.0.1:51035/nut76_disposable?schema=nut76_test',
    'postgresql://test:test@[::1]:65432/nut76_isolated?schema=nut76_test',
  ])('accepts only explicit local PostgreSQL endpoints on a temporary port', url => {
    expect(assertSafeDatabaseUrl(url).schema).toBe('nut76_test');
  });
});

describeWithDb('NUT-76 real persistence on isolated local PostgreSQL', () => {
  let schema: string;
  let admin: Client;
  let pool: Pool;
  let prisma: PrismaClient;
  let repository: PlansRepository;
  let applicationName: string;

  beforeAll(async () => {
    const safe = assertSafeDatabaseUrl(dbUrl!);
    schema = safe.schema;
    applicationName = `nut76_${randomBytes(5).toString('hex')}`;
    const connectionOptions = `-c search_path=${schema},public -c application_name=${applicationName}`;
    admin = new Client({ connectionString: dbUrl, options: connectionOptions });
    await admin.connect();

    const migrationsDir = path.resolve(__dirname, '../../../../prisma/migrations');
    const expectedMigrations = fs.readdirSync(migrationsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter(name => fs.existsSync(path.join(migrationsDir, name, 'migration.sql')))
      .sort();
    const applied = await admin.query<{ migration_name: string }>(
      `SELECT migration_name FROM "${schema}"."_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    );
    expect(applied.rows.map(row => row.migration_name).sort()).toEqual(expectedMigrations);

    pool = new Pool({ connectionString: dbUrl, options: connectionOptions });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    await prisma.$connect();
    repository = new PlansRepository(prisma as any);
  }, 60000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await admin?.end().catch(() => undefined);
  });

  async function createUser(label: string): Promise<string> {
    const email = `nut76-${label}-${randomUUID()}@example.test`;
    const user = await prisma.user.create({ data: { email, passwordHash: 'synthetic-test-hash' } });
    await prisma.nutritionProfile.create({
      data: {
        userId: user.id,
        goal: 'MAINTAIN',
        diet: 'ALL',
        excludedIngredients: [],
        cookTimePreference: 'STANDARD',
      },
    });
    return user.id;
  }

  async function createPendingRun(userId: string, key = randomUUID()) {
    return prisma.generationRun.create({
      data: {
        userId,
        kind: 'MEAL_PLAN_INITIAL',
        provider: 'test-provider',
        model: 'test-model',
        promptVersion: 'nut76-test-prompt-v1',
        schemaVersion: 'nut76-test-schema-v1',
        requestSnapshot: { kind: 'MEAL_PLAN_INITIAL', weekStart: weekStartStr },
        profileSnapshot: { goal: 'MAINTAIN', diet: 'ALL' },
        idempotencyKeyHash: key,
      },
    });
  }

  function draftMeal(index: number, mealType: MealType, reuseRecipeId?: string) {
    if (reuseRecipeId) {
      return {
        mealType,
        title: 'stale title supplied by proposal',
        nutritionalValues: { Calories: 1, Protein: 1, Fiber: 1, Description: 'stale nutrition' },
        recipe: undefined,
        reuseRecipeId,
      };
    }
    const description = `AI recipe ${index} persisted description`;
    const calories = 300 + index;
    const protein = 20 + index;
    const fiber = 5 + index;
    return {
      mealType,
      title: `AI meal ${index}`,
      nutritionalValues: { Calories: calories, Protein: protein, Fiber: fiber, Description: description },
      recipe: {
        title: `AI recipe ${index}`,
        description,
        prepMinutes: 10,
        cookMinutes: 15,
        ingredients: [{ name: `Synthetic ingredient ${index}`, quantity: 100, unit: 'g' }],
        instructions: [`Synthetic step ${index}`],
        nutritionalValues: { calories, protein, fiber, description },
      },
    };
  }

  function weekDays(reuseRecipeId?: string): any[] {
    return dayOrder.map((day, dayIndex) => ({
      day,
      date: new Date(weekStart.getTime() + dayIndex * 86_400_000).toISOString().slice(0, 10),
      meals: mealOrder.map((mealType, mealIndex) => {
        const index = dayIndex * mealOrder.length + mealIndex;
        return draftMeal(index, mealType, index === 0 ? reuseRecipeId : undefined);
      }),
    }));
  }

  function proposal(days = weekDays()) {
    return {
      dto: { weekStart: weekStartStr, days },
      comparableDays: days,
      summary: { stage: 'passed', codes: [], warnings: [] },
      compositionSnapshot: {
        compositionVersion: 'weekly-catalog-composition-v1',
        aiInvoked: true,
        batches: [{ mealType: MealType.BREAKFAST, count: 28, model: 'test-model', promptVersion: 'test-prompt', schemaVersion: 'test-schema' }],
      },
    };
  }

  function makeService(compose: jest.Mock, images?: Record<string, any>) {
    const imageBoundary = images ?? {
      resolveImagesOrDegrade: jest.fn(async (days: unknown[]) => days),
      trackNewRecipeImages: jest.fn(async () => undefined),
    };
    return {
      service: new PlansService(repository, imageBoundary as any, { get: () => undefined } as any, {
        composeWeeklyProposal: compose,
      } as any),
      imageBoundary,
    };
  }

  it('persists 7 days and 28 meals, reuses one shared Recipe intact, and creates 27 AI Recipes once', async () => {
    const userId = await createUser('writer');
    const run = await createPendingRun(userId);
    const existingRecipe = await prisma.recipe.create({
      data: {
        title: 'Catalog Recipe to reuse',
        description: 'Nutrition comes from this persisted Recipe',
        prepMinutes: 7,
        cookMinutes: 9,
        ingredients: [{ name: 'Catalog item', quantity: 2, unit: 'g' }],
        instructions: ['Catalog instruction'],
        nutritionalValues: { calories: 444, protein: 31, fiber: 12 },
        image: { provider: 'fixture', imageUrl: 'https://example.test/catalog.jpg' },
        origin: 'MANUAL',
      },
    });
    const originalRecipe = await prisma.recipe.findUniqueOrThrow({ where: { id: existingRecipe.id } });
    const otherPlan = await prisma.mealPlan.create({
      data: {
        userId,
        startDate: new Date('2026-09-21T00:00:00.000Z'),
        endDate: new Date('2026-09-27T00:00:00.000Z'),
        days: { create: [{
          day: DayOfWeek.MONDAY,
          date: new Date('2026-09-21T00:00:00.000Z'),
          meals: { create: [{
            mealType: MealType.LUNCH,
            title: existingRecipe.title,
            nutritionalValues: { Calories: 444, Protein: 31, Fiber: 12, Description: existingRecipe.description },
            recipeId: existingRecipe.id,
          }] },
        }] },
      },
    });

    const result = await repository.createPlanTransaction(
      userId,
      weekStart,
      weekDays(existingRecipe.id) as any,
      run.id,
      undefined,
      { stage: 'passed', codes: [], warnings: [] },
      proposal().compositionSnapshot,
    );
    const persisted = await prisma.mealPlan.findUniqueOrThrow({
      where: { id: result.planId },
      include: { days: { include: { meals: { include: { recipe: true } } } } },
    });
    const meals = persisted.days.flatMap(day => day.meals);
    const aiRecipes = await prisma.recipe.findMany({ where: { generationRunId: run.id } });
    const reusedMeal = meals.find(meal => meal.recipeId === existingRecipe.id)!;

    expect(persisted.days).toHaveLength(7);
    expect(meals).toHaveLength(28);
    expect(meals.every(meal => meal.recipeId)).toBe(true);
    expect(aiRecipes).toHaveLength(27);
    expect(new Set(aiRecipes.map(recipe => recipe.id)).size).toBe(27);
    expect(meals.filter(meal => aiRecipes.some(recipe => recipe.id === meal.recipeId))).toHaveLength(27);
    for (const meal of meals) {
      const selectedRecipe = meal.recipe!;
      const nutrition = selectedRecipe.nutritionalValues as Record<string, unknown>;
      expect(meal.nutritionalValues).toEqual({
        Calories: nutrition.calories,
        Protein: nutrition.protein,
        Fiber: nutrition.fiber,
        Description: selectedRecipe.description,
      });
    }
    expect(reusedMeal.nutritionalValues).toEqual({
      Calories: 444,
      Protein: 31,
      Fiber: 12,
      Description: existingRecipe.description,
    });
    expect(await prisma.recipe.findUniqueOrThrow({ where: { id: existingRecipe.id } })).toEqual(originalRecipe);
    expect((await prisma.generationRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('SUCCEEDED');

    await repository.deletePlanTransaction(result.planId, userId);
    expect(await prisma.recipe.findUniqueOrThrow({ where: { id: existingRecipe.id } })).toEqual(originalRecipe);
    expect(await prisma.plannedMeal.count({ where: { day: { mealPlanId: otherPlan.id }, recipeId: existingRecipe.id } })).toBe(1);
  }, 30000);

  it('persists provider/model none for a catalog-only run without creating AI Recipes', async () => {
    const userId = await createUser('catalog-only');
    const run = await createPendingRun(userId);
    const recipes = await Promise.all(Array.from({ length: 28 }, (_, index) => prisma.recipe.create({
      data: {
        title: `Catalog-only Recipe ${index}`,
        description: `Catalog-only description ${index}`,
        prepMinutes: 5,
        cookMinutes: 10,
        ingredients: [{ name: `Catalog-only ingredient ${index}`, quantity: 1, unit: 'g' }],
        instructions: ['Prepare'],
        nutritionalValues: { calories: 250, protein: 15, fiber: 6 },
      },
    })));
    const days = weekDays().map((day, dayIndex) => ({
      ...day,
      meals: day.meals.map((meal: any, mealIndex: number) => ({
        ...meal,
        recipe: undefined,
        reuseRecipeId: recipes[dayIndex * mealOrder.length + mealIndex].id,
      })),
    }));

    const result = await repository.createPlanTransaction(
      userId,
      weekStart,
      days as any,
      run.id,
      undefined,
      { stage: 'passed', codes: [], warnings: [] },
      { compositionVersion: 'weekly-catalog-composition-v1', aiInvoked: false, batches: [] },
    );

    const persistedRun = await prisma.generationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(persistedRun).toMatchObject({ status: 'SUCCEEDED', provider: 'none', model: 'none' });
    expect(await prisma.recipe.count({ where: { generationRunId: run.id } })).toBe(0);
    expect(await prisma.mealPlan.count({ where: { id: result.planId } })).toBe(1);
  }, 30000);

  it('rolls back plan, Recipe, day and meals when a real PlannedMeal insert fails', async () => {
    const userId = await createUser('planned-meal-rollback');
    const run = await createPendingRun(userId);
    const token = randomBytes(5).toString('hex');
    const functionName = `nut76_fail_${token}`;
    const triggerName = `nut76_fail_trigger_${token}`;
    const failingTitle = `NUT76_FAIL_${token}`;
    await admin.query(`CREATE FUNCTION "${schema}"."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."title" = '${failingTitle}' THEN RAISE EXCEPTION 'planned meal failure fixture'; END IF; RETURN NEW; END; $$`);
    await admin.query(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "${schema}"."planned_meals"
      FOR EACH ROW EXECUTE FUNCTION "${schema}"."${functionName}"()`);
    try {
      const days = [{ ...weekDays()[0], meals: [{ ...draftMeal(0, MealType.BREAKFAST), title: failingTitle }] }];
      await expect(repository.createPlanTransaction(userId, weekStart, days as any, run.id)).rejects.toThrow(/planned meal failure fixture/);

      expect(await prisma.mealPlan.count({ where: { generationRunId: run.id } })).toBe(0);
      expect(await prisma.mealPlanDay.count({ where: { mealPlan: { generationRunId: run.id } } })).toBe(0);
      expect(await prisma.plannedMeal.count({ where: { day: { mealPlan: { generationRunId: run.id } } } })).toBe(0);
      expect(await prisma.recipe.count({ where: { generationRunId: run.id } })).toBe(0);
      expect((await prisma.generationRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('PENDING');
    } finally {
      await admin.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${schema}"."planned_meals"`);
      await admin.query(`DROP FUNCTION IF EXISTS "${schema}"."${functionName}"()`);
    }
  }, 30000);

  it('rolls back the domain transaction when PENDING to SUCCEEDED loses its compare-and-set', async () => {
    const userId = await createUser('cas-rollback');
    const run = await createPendingRun(userId);
    const functionName = `nut76_cas_${randomBytes(5).toString('hex')}`;
    const triggerName = `${functionName}_trigger`;
    await admin.query(`CREATE FUNCTION "${schema}"."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE run_id TEXT;
      BEGIN
        SELECT mp."generationRunId" INTO run_id
        FROM "${schema}"."meal_plans" mp
        JOIN "${schema}"."meal_plan_days" md ON md."mealPlanId" = mp."id"
        WHERE md."id" = NEW."dayId";
        UPDATE "${schema}"."generation_runs"
        SET "status" = 'FAILED', "completedAt" = NOW()
        WHERE "id" = run_id AND "status" = 'PENDING';
        RETURN NEW;
      END; $$`);
    await admin.query(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "${schema}"."planned_meals"
      FOR EACH ROW EXECUTE FUNCTION "${schema}"."${functionName}"()`);
    try {
      await expect(repository.createPlanTransaction(
        userId,
        weekStart,
        [{ ...weekDays()[0], meals: [draftMeal(0, MealType.BREAKFAST)] }] as any,
        run.id,
      )).rejects.toThrow(/transition conflict/i);
      expect(await prisma.mealPlan.count({ where: { generationRunId: run.id } })).toBe(0);
      expect(await prisma.mealPlanDay.count({ where: { mealPlan: { generationRunId: run.id } } })).toBe(0);
      expect(await prisma.plannedMeal.count({ where: { day: { mealPlan: { generationRunId: run.id } } } })).toBe(0);
      expect(await prisma.recipe.count({ where: { generationRunId: run.id } })).toBe(0);
      expect((await prisma.generationRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('PENDING');
    } finally {
      await admin.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${schema}"."planned_meals"`).catch(() => undefined);
      await admin.query(`DROP FUNCTION IF EXISTS "${schema}"."${functionName}"()`).catch(() => undefined);
    }
  }, 30000);

  it('coordinates two generate requests into one composition, plan and run', async () => {
    const userId = await createUser('same-week-race');
    let enterComposer!: () => void;
    let releaseComposer!: () => void;
    const entered = new Promise<void>(resolve => { enterComposer = resolve; });
    const barrier = new Promise<void>(resolve => { releaseComposer = resolve; });
    const compose = jest.fn(async () => {
      enterComposer();
      await barrier;
      return proposal();
    });
    const { service } = makeService(compose);
    try {
      const first = service.generateAndPersistPlan(userId, weekStartStr);
      await entered;
      await expect(service.generateAndPersistPlan(userId, weekStartStr)).rejects.toMatchObject({ status: 409 });
      releaseComposer();
      await expect(first).resolves.toBeDefined();

      expect(compose).toHaveBeenCalledTimes(1);
      expect(await prisma.generationRun.count({ where: { userId, kind: 'MEAL_PLAN_INITIAL' } })).toBe(1);
      expect(await prisma.mealPlan.count({ where: { userId, startDate: weekStart, isCurrent: true } })).toBe(1);
    } finally {
      releaseComposer();
    }
  }, 30000);

  it('rejects a current-plan insert in the pre-transaction window without a second current plan or SUCCEEDED run', async () => {
    const userId = await createUser('current-plan-race');
    let enterImages!: () => void;
    let releaseImages!: () => void;
    const entered = new Promise<void>(resolve => { enterImages = resolve; });
    const barrier = new Promise<void>(resolve => { releaseImages = resolve; });
    const imageBoundary = {
      resolveImagesOrDegrade: jest.fn(async (days: unknown[]) => {
        enterImages();
        await barrier;
        return days;
      }),
      trackNewRecipeImages: jest.fn(async () => undefined),
    };
    const compose = jest.fn(async () => proposal());
    const { service } = makeService(compose, imageBoundary);
    try {
      const pending = service.generateAndPersistPlan(userId, weekStartStr);
      await entered;
      const concurrentPlan = await prisma.mealPlan.create({
        data: {
          userId,
          startDate: weekStart,
          endDate: new Date('2026-09-20T00:00:00.000Z'),
        },
      });
      releaseImages();
      await expect(pending).rejects.toMatchObject({ code: 'P2002' });

      const currentPlans = await prisma.mealPlan.findMany({ where: { userId, startDate: weekStart, isCurrent: true } });
      expect(currentPlans.map(plan => plan.id)).toEqual([concurrentPlan.id]);
      const run = await prisma.generationRun.findFirstOrThrow({ where: { userId, kind: 'MEAL_PLAN_INITIAL' } });
      expect(run.status).toBe('FAILED');
      expect(await prisma.mealPlan.count({ where: { generationRunId: run.id } })).toBe(0);
      expect(await prisma.recipe.count({ where: { generationRunId: run.id } })).toBe(0);
    } finally {
      releaseImages();
    }
  }, 30000);

  it('allows exactly one of two concurrent conditional GenerationRun transitions to win', async () => {
    const userId = await createUser('transition-race');
    const run = await createPendingRun(userId);

    const results = await Promise.all([
      repository.transitionGenerationRun(run.id, userId, ['PENDING'], 'FAILED', { errorCode: 'TEST_FAILURE' }),
      repository.transitionGenerationRun(run.id, userId, ['PENDING'], 'REJECTED', { errorCode: 'TEST_REJECTION' }),
    ]);

    expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(results.filter(count => count === 1)).toHaveLength(1);
    expect(results.filter(count => count === 0)).toHaveLength(1);
    const persisted = await prisma.generationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(['FAILED', 'REJECTED']).toContain(persisted.status);
  }, 30000);
});
