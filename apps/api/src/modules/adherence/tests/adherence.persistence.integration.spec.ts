import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { Client, Pool } from 'pg';
import { AdherenceRepository } from '../adherence.repository';
import { AdherenceService } from '../adherence.service';
import { RecipeRepository } from '../../recipe/recipe.repository';
import { PlansRepository } from '../../plans/plans.repository';

// This suite creates a private schema on an explicitly named disposable local PostgreSQL.
// It never falls back to DATABASE_URL and never connects to a remote host.
const dbUrl = process.env.ADHERENCE_TEST_DATABASE_URL;
const describeWithDb = dbUrl ? describe : describe.skip;
const weekStart = '2026-10-19';
const dayDate = new Date('2026-10-20T00:00:00.000Z');
const baseClock = '2026-10-20T16:00:00.000Z';

describeWithDb('adherence persistence on isolated local PostgreSQL', () => {
  let schema: string;
  let admin: Client;
  let pool: Pool;
  let prisma: any;
  let applicationName: string;

  beforeAll(async () => {
    const parsed = new URL(dbUrl!);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)) {
      throw new Error('ADHERENCE_TEST_DATABASE_URL must point to a disposable local PostgreSQL instance');
    }

    schema = `nut91_it_${randomBytes(6).toString('hex')}`;
    applicationName = `nut91_${randomBytes(6).toString('hex')}`;
    admin = new Client({ connectionString: dbUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);

    const options = `-c search_path=${schema},public -c application_name=${applicationName}`;
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
  }, 60000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    if (admin) {
      if (schema) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });

  async function fixture(suffix: string, options: { date?: Date; week?: string; sharedRecipe?: any; mealCount?: number } = {}) {
    const user = await prisma.user.create({ data: {
      email: `adherence-${suffix}-${randomBytes(4).toString('hex')}@example.test`,
      passwordHash: 'synthetic-test-hash',
    } });
    const recipe = options.sharedRecipe ?? await prisma.recipe.create({ data: {
      title: 'Receta sintética de adherencia',
      description: 'Synthetic adherence test recipe',
      prepMinutes: 5,
      cookMinutes: 10,
      ingredients: [{ name: 'Avena', quantity: 1, unit: 'g' }],
      instructions: ['Synthetic step'],
    } });
    const start = options.week ?? weekStart;
    const date = options.date ?? dayDate;
    const plan = await prisma.mealPlan.create({
      data: {
        userId: user.id,
        startDate: new Date(`${start}T00:00:00.000Z`),
        endDate: new Date(new Date(`${start}T00:00:00.000Z`).getTime() + 6 * 86_400_000),
        days: { create: [{
          day: 'TUESDAY',
          date,
          meals: { create: Array.from({ length: options.mealCount ?? 1 }, (_, index) => ({
            mealType: index ? 'DINNER' : 'LUNCH',
            title: `Synthetic meal ${index + 1}`,
            recipeId: recipe.id,
            nutritionalValues: {},
          })) },
        }] },
      },
      include: { days: { include: { meals: true } } },
    });
    return { user, recipe, plan, meals: plan.days[0].meals };
  }

  async function weekFixture(suffix: string, options: { week?: string; dayOffsets?: number[] } = {}) {
    const user = await prisma.user.create({ data: {
      email: `adherence-week-${suffix}-${randomBytes(4).toString('hex')}@example.test`,
      passwordHash: 'synthetic-test-hash',
    } });
    const recipe = await prisma.recipe.create({ data: {
      title: `Synthetic weekly recipe ${suffix}`,
      description: 'Synthetic adherence week recipe',
      prepMinutes: 5,
      cookMinutes: 10,
      ingredients: [{ name: 'Avena', quantity: 1, unit: 'g' }],
      instructions: ['Synthetic step'],
    } });
    const start = options.week ?? weekStart;
    const weekdayNames = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const mealTypes = ['BREAKFAST', 'LUNCH', 'SNACK', 'DINNER', 'BREAKFAST', 'LUNCH', 'DINNER'];
    const offsets = options.dayOffsets ?? [0, 1, 2, 3, 4, 5, 6];
    const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
    const plan = await prisma.mealPlan.create({
      data: {
        userId: user.id,
        startDate: new Date(startMs),
        endDate: new Date(startMs + 6 * 86_400_000),
        days: { create: offsets.map((offset) => ({
          day: weekdayNames[offset],
          date: new Date(startMs + offset * 86_400_000),
          meals: { create: [{
            mealType: mealTypes[offset],
            title: `Synthetic meal ${weekdayNames[offset]}`,
            recipeId: recipe.id,
            nutritionalValues: {},
          }] },
        })) },
      },
      include: { days: { include: { meals: true } } },
    });
    return { user, recipe, plan, days: plan.days, meals: plan.days.flatMap((day: any) => day.meals) };
  }

  function repository(now = baseClock) {
    return new AdherenceRepository(prisma, () => new Date(now));
  }

  function put(repo: AdherenceRepository, fixtureValue: any, status: 'NOT_LOGGED' | 'COMPLETED' | 'SKIPPED', token?: Date) {
    return repo.setMealStatus(fixtureValue.user.id, fixtureValue.meals[0].id, {
      planId: fixtureValue.plan.id,
      mealUpdatedAt: (token ?? fixtureValue.meals[0].updatedAt).toISOString(),
      status,
    });
  }

  function expectMealCompletionRecord(record: any, fixtureValue: any, status: 'NOT_LOGGED' | 'COMPLETED' | 'SKIPPED') {
    expect(record).toMatchObject({
      id: expect.any(String),
      userId: fixtureValue.user.id,
      plannedMealId: fixtureValue.meals[0].id,
      recipeIdSnapshot: fixtureValue.meals[0].recipeId,
      mealUpdatedAtSnapshot: fixtureValue.meals[0].updatedAt,
      status,
      updatedAt: expect.any(Date),
    });
    return record;
  }

  async function replaceMealInPlan(value: any, recipeId: string) {
    const generationRun = await prisma.generationRun.create({ data: {
      userId: value.user.id,
      kind: 'MEAL_REPLACEMENT',
      provider: 'synthetic-test',
      model: 'synthetic-test',
      promptVersion: 'synthetic-test',
      schemaVersion: 'synthetic-test',
      requestSnapshot: {},
      profileSnapshot: {},
    } });
    const plans = new PlansRepository(prisma);
    return plans.replaceMealTransaction({
      userId: value.user.id,
      planId: value.plan.id,
      expectedPlanUpdatedAt: value.plan.updatedAt,
      plannedMealId: value.meals[0].id,
      generationRunId: generationRun.id,
      existingRecipeId: recipeId,
      nutritionalValues: {},
      outputSnapshot: { source: 'synthetic-test' },
      validationSnapshot: { source: 'synthetic-test' },
    });
  }

  async function waitForBlockedTransactions(expectedCount: number): Promise<void> {
    const deadline = Date.now() + 7_000;
    while (Date.now() < deadline) {
      const activity = await admin.query<{ waiting: number }>(`
        SELECT COUNT(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND application_name = $1
      `, [applicationName]);
      if (activity.rows[0].waiting >= expectedCount) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Expected ${expectedCount} NUT-91 transactions to wait on a database lock`);
  }

  it('reads only the caller current plan and completions, even when another user has the same week', async () => {
    const emptyUser = await prisma.user.create({ data: {
      email: `adherence-empty-${randomBytes(4).toString('hex')}@example.test`,
      passwordHash: 'synthetic-test-hash',
    } });
    const repo = repository();
    const emptyBeforeOtherPlans = await repo.getCurrentSnapshot(emptyUser.id, weekStart);
    const owner = await weekFixture('snapshot-owner');
    const other = await weekFixture('snapshot-other');
    const emptyPeer = await prisma.user.create({ data: {
      email: `adherence-empty-peer-${randomBytes(4).toString('hex')}@example.test`,
      passwordHash: 'synthetic-test-hash',
    } });
    const ownerMeal = owner.meals[0];
    await prisma.mealCompletion.create({ data: {
      userId: other.user.id,
      plannedMealId: ownerMeal.id,
      recipeIdSnapshot: ownerMeal.recipeId,
      mealUpdatedAtSnapshot: ownerMeal.updatedAt,
      status: 'COMPLETED',
    } });

    const ownerSnapshot = await repo.getCurrentSnapshot(owner.user.id, weekStart);
    const emptyWithOtherPlans = await repo.getCurrentSnapshot(emptyUser.id, weekStart);
    const emptyWithoutOwnedPlan = await repo.getCurrentSnapshot(emptyPeer.id, weekStart);

    expect(ownerSnapshot.plan).toMatchObject({ id: owner.plan.id, version: owner.plan.version });
    expect(ownerSnapshot.days).toHaveLength(7);
    expect(ownerSnapshot.meals.map((meal: any) => meal.id).sort()).toEqual(owner.meals.map((meal: any) => meal.id).sort());
    expect(ownerSnapshot.completions).toEqual([]);
    expect(emptyBeforeOtherPlans).toEqual(emptyWithOtherPlans);
    expect(emptyWithOtherPlans).toEqual({ plan: null, days: [], meals: [], completions: [] });
    expect(emptyWithOtherPlans).toEqual(emptyWithoutOwnedPlan);
    expect(JSON.stringify(emptyWithOtherPlans)).not.toContain(other.plan.id);
  }, 30000);

  it('returns only persisted dates and meals for a partial legacy week', async () => {
    const partial = await weekFixture('partial', { dayOffsets: [3, 0] });
    const snapshot = await repository().getCurrentSnapshot(partial.user.id, weekStart);

    expect(snapshot.plan).toMatchObject({ id: partial.plan.id });
    expect(snapshot.days.map((day: any) => day.date.toISOString().slice(0, 10))).toEqual(['2026-10-19', '2026-10-22']);
    expect(snapshot.meals).toHaveLength(2);
    expect(snapshot.meals.every((meal: any) => partial.meals.some((stored: any) => stored.id === meal.id))).toBe(true);
  }, 30000);

  it('leaves completions and plan/meal timestamps unchanged during the GET snapshot read', async () => {
    const value = await weekFixture('read-only');
    const meal = value.meals[0];
    await prisma.mealCompletion.create({ data: {
      userId: value.user.id,
      plannedMealId: meal.id,
      recipeIdSnapshot: meal.recipeId,
      mealUpdatedAtSnapshot: meal.updatedAt,
      status: 'COMPLETED',
    } });
    const before = {
      plan: await prisma.mealPlan.findUnique({ where: { id: value.plan.id } }),
      meals: await prisma.plannedMeal.findMany({ where: { day: { mealPlanId: value.plan.id } }, orderBy: { id: 'asc' } }),
      completions: await prisma.mealCompletion.findMany({ where: { userId: value.user.id }, orderBy: { plannedMealId: 'asc' } }),
    };

    const snapshot = await repository().getCurrentSnapshot(value.user.id, weekStart);

    const after = {
      plan: await prisma.mealPlan.findUnique({ where: { id: value.plan.id } }),
      meals: await prisma.plannedMeal.findMany({ where: { day: { mealPlanId: value.plan.id } }, orderBy: { id: 'asc' } }),
      completions: await prisma.mealCompletion.findMany({ where: { userId: value.user.id }, orderBy: { plannedMealId: 'asc' } }),
    };
    expect(snapshot.completions).toHaveLength(1);
    expect(after).toEqual(before);
  }, 30000);

  it('keeps plan, meal, and completion reads on one RepeatableRead snapshot across a concurrent commit', async () => {
    const value = await weekFixture('repeatable-read');
    const meal = value.meals[0];
    let announceDaysRead!: () => void;
    let resumeRead!: () => void;
    const daysRead = new Promise<void>((resolve) => { announceDaysRead = resolve; });
    const resume = new Promise<void>((resolve) => { resumeRead = resolve; });
    const coordinatedPrisma = {
      $transaction: (callback: (tx: unknown) => Promise<unknown>, options: unknown) => prisma.$transaction(async (tx: any) => {
        const dayDelegate = new Proxy(tx.mealPlanDay, {
          get(target, property) {
            const member = Reflect.get(target, property);
            if (property === 'findMany') {
              return async (...args: unknown[]) => {
                const result = await member.call(target, ...args);
                announceDaysRead();
                await resume;
                return result;
              };
            }
            return typeof member === 'function' ? member.bind(target) : member;
          },
        });
        const transaction = new Proxy(tx, {
          get(target, property) {
            if (property === 'mealPlanDay') return dayDelegate;
            const member = Reflect.get(target, property);
            return typeof member === 'function' ? member.bind(target) : member;
          },
        });
        return callback(transaction);
      }, options),
    };
    const repo = new AdherenceRepository(coordinatedPrisma as any, () => new Date('2026-10-24T16:00:00.000Z'));
    const inFlightRead = repo.getCurrentSnapshot(value.user.id, weekStart);

    await daysRead;
    try {
      await prisma.mealPlan.update({
        where: { id: value.plan.id },
        data: { version: value.plan.version + 1 },
      });
      await prisma.plannedMeal.update({
        where: { id: meal.id },
        data: { title: 'Concurrent update after snapshot began' },
      });
      await prisma.mealCompletion.create({ data: {
        userId: value.user.id,
        plannedMealId: meal.id,
        recipeIdSnapshot: meal.recipeId,
        mealUpdatedAtSnapshot: meal.updatedAt,
        status: 'COMPLETED',
      } });
    } finally {
      resumeRead();
    }

    const consistent = await inFlightRead;
    const subsequent = await repository().getCurrentSnapshot(value.user.id, weekStart);
    expect(consistent.plan?.version).toBe(value.plan.version);
    expect(consistent.meals.find((candidate: any) => candidate.id === meal.id)?.title).toBe(meal.title);
    expect(consistent.completions).toEqual([]);
    expect(subsequent.plan?.version).toBe(value.plan.version + 1);
    expect(subsequent.meals.find((candidate: any) => candidate.id === meal.id)?.title)
      .toBe('Concurrent update after snapshot began');
    expect(subsequent.completions).toHaveLength(1);
  }, 30000);

  it('projects PostgreSQL snapshot states read-only and returns only the regenerated current plan', async () => {
    const value = await weekFixture('get-projection');
    const todayClock = '2026-10-22T16:00:00.000Z';
    const service = new AdherenceService(repository(todayClock), () => new Date(todayClock));
    const mealForDate = (date: string) => {
      const day = value.days.find((candidate: any) => candidate.date.toISOString().slice(0, 10) === date);
      return value.meals.find((meal: any) => meal.dayId === day.id);
    };
    const currentMeal = mealForDate('2026-10-19');
    const staleTimeMeal = mealForDate('2026-10-20');
    const staleRecipeMeal = mealForDate('2026-10-21');
    const futureMeal = mealForDate('2026-10-23');

    await prisma.mealCompletion.create({ data: {
      userId: value.user.id,
      plannedMealId: currentMeal.id,
      recipeIdSnapshot: currentMeal.recipeId,
      mealUpdatedAtSnapshot: currentMeal.updatedAt,
      status: 'COMPLETED',
    } });
    await prisma.mealCompletion.create({ data: {
      userId: value.user.id,
      plannedMealId: staleTimeMeal.id,
      recipeIdSnapshot: staleTimeMeal.recipeId,
      mealUpdatedAtSnapshot: new Date(staleTimeMeal.updatedAt.getTime() - 1),
      status: 'COMPLETED',
    } });
    await prisma.mealCompletion.create({ data: {
      userId: value.user.id,
      plannedMealId: staleRecipeMeal.id,
      recipeIdSnapshot: null,
      mealUpdatedAtSnapshot: staleRecipeMeal.updatedAt,
      status: 'SKIPPED',
    } });
    await prisma.mealCompletion.create({ data: {
      userId: value.user.id,
      plannedMealId: futureMeal.id,
      recipeIdSnapshot: futureMeal.recipeId,
      mealUpdatedAtSnapshot: futureMeal.updatedAt,
      status: 'COMPLETED',
    } });

    const readState = async (planIds: string[]) => {
      const [plans, mealsByPlan, completions] = await Promise.all([
        prisma.mealPlan.findMany({ where: { id: { in: planIds } }, orderBy: { id: 'asc' } }),
        Promise.all(planIds.map((planId) => prisma.plannedMeal.findMany({
          where: { day: { mealPlanId: planId } },
          orderBy: { id: 'asc' },
        }))),
        prisma.mealCompletion.findMany({ where: { userId: value.user.id }, orderBy: { plannedMealId: 'asc' } }),
      ]);
      return { plans, mealsByPlan, completions };
    };

    const beforeGet = await readState([value.plan.id]);
    const response = await service.getForWeek(value.user.id, weekStart);
    const afterGet = await readState([value.plan.id]);
    expect(afterGet).toEqual(beforeGet);

    const responseMeals = response.days.flatMap((day: any) => day.meals);
    const statusById = new Map(responseMeals.map((meal: any) => [meal.plannedMealId, meal]));
    expect(response.today).toBe('2026-10-22');
    expect(statusById.get(currentMeal.id)).toMatchObject({ status: 'COMPLETED', canEdit: true });
    expect(statusById.get(staleTimeMeal.id)).toMatchObject({ status: 'NOT_LOGGED', canEdit: true });
    expect(statusById.get(staleRecipeMeal.id)).toMatchObject({ status: 'NOT_LOGGED', canEdit: true });
    expect(statusById.get(futureMeal.id)).toMatchObject({ status: 'NOT_LOGGED', canEdit: false });
    expect(response.summary).toMatchObject({
      plannedMeals: 7,
      completedMeals: 1,
      skippedMeals: 0,
      notLoggedMeals: 6,
      adherencePercent: 14.3,
    });

    await prisma.mealPlan.update({ where: { id: value.plan.id }, data: { isCurrent: false } });
    const startMs = new Date(`${weekStart}T00:00:00.000Z`).getTime();
    const weekdayNames = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const mealTypes = ['BREAKFAST', 'LUNCH', 'SNACK', 'DINNER', 'BREAKFAST', 'LUNCH', 'DINNER'];
    const regenerated = await prisma.mealPlan.create({
      data: {
        userId: value.user.id,
        startDate: new Date(startMs),
        endDate: new Date(startMs + 6 * 86_400_000),
        version: value.plan.version + 1,
        supersedesId: value.plan.id,
        days: { create: weekdayNames.map((day, offset) => ({
          day,
          date: new Date(startMs + offset * 86_400_000),
          meals: { create: [{
            mealType: mealTypes[offset],
            title: `Regenerated synthetic meal ${day}`,
            recipeId: value.recipe.id,
            nutritionalValues: {},
          }] },
        })) },
      },
      include: { days: { include: { meals: true } } },
    });
    const regeneratedMealIds = regenerated.days.flatMap((day: any) => day.meals.map((meal: any) => meal.id));
    const beforeRegeneratedGet = await readState([value.plan.id, regenerated.id]);
    const regeneratedResponse = await service.getForWeek(value.user.id, weekStart);
    const afterRegeneratedGet = await readState([value.plan.id, regenerated.id]);

    expect(afterRegeneratedGet).toEqual(beforeRegeneratedGet);
    expect(regeneratedResponse.plan).toMatchObject({ id: regenerated.id, version: value.plan.version + 1 });
    const returnedMealIds = regeneratedResponse.days.flatMap((day: any) => day.meals.map((meal: any) => meal.plannedMealId));
    expect(returnedMealIds).toHaveLength(7);
    expect(returnedMealIds.sort()).toEqual([...regeneratedMealIds].sort());
    expect(returnedMealIds.some((id: string) => value.meals.some((meal: any) => meal.id === id))).toBe(false);
    expect(regeneratedResponse.days.flatMap((day: any) => day.meals).every((meal: any) => meal.status === 'NOT_LOGGED')).toBe(true);
    expect(regeneratedResponse.summary).toEqual({
      plannedMeals: 7,
      completedMeals: 0,
      skippedMeals: 0,
      notLoggedMeals: 7,
      adherencePercent: 0,
    });
    expect(afterRegeneratedGet.completions).toHaveLength(4);
    expect(await prisma.mealCompletion.findMany({ where: { plannedMealId: { in: regeneratedMealIds } } })).toEqual([]);
  }, 30000);

  it('persists NOT_LOGGED, transitions all states idempotently, and leaves plan/meal timestamps untouched', async () => {
    const value = await fixture('states');
    const repo = repository();
    const mealBefore = await prisma.plannedMeal.findUnique({ where: { id: value.meals[0].id } });
    const planBefore = await prisma.mealPlan.findUnique({ where: { id: value.plan.id } });

    const firstResult = expectMealCompletionRecord(await put(repo, value, 'NOT_LOGGED'), value, 'NOT_LOGGED');
    let completion = await prisma.mealCompletion.findUnique({ where: { plannedMealId: value.meals[0].id } });
    expect(completion).toMatchObject({
      userId: value.user.id,
      plannedMealId: value.meals[0].id,
      recipeIdSnapshot: value.recipe.id,
      mealUpdatedAtSnapshot: value.meals[0].updatedAt,
      status: 'NOT_LOGGED',
    });
    expect(completion.updatedAt).toBeInstanceOf(Date);
    expect(firstResult).toEqual(completion);

    const sentinel = new Date('2026-01-01T00:00:00.000Z');
    await prisma.mealCompletion.update({ where: { plannedMealId: value.meals[0].id }, data: { updatedAt: sentinel } });
    const noOpResult = expectMealCompletionRecord(await put(repo, value, 'NOT_LOGGED'), value, 'NOT_LOGGED');
    completion = await prisma.mealCompletion.findUnique({ where: { plannedMealId: value.meals[0].id } });
    expect(noOpResult.id).toBe(firstResult.id);
    expect(noOpResult.updatedAt).toEqual(sentinel);
    expect(noOpResult).toEqual(completion);
    expect(completion.updatedAt).toEqual(sentinel);
    expect(await prisma.mealCompletion.count({ where: { plannedMealId: value.meals[0].id } })).toBe(1);

    expectMealCompletionRecord(await put(repo, value, 'COMPLETED'), value, 'COMPLETED');
    expect(await prisma.mealCompletion.count({ where: { plannedMealId: value.meals[0].id } })).toBe(1);
    expectMealCompletionRecord(await put(repo, value, 'SKIPPED'), value, 'SKIPPED');
    expect(await prisma.mealCompletion.count({ where: { plannedMealId: value.meals[0].id } })).toBe(1);
    expectMealCompletionRecord(await put(repo, value, 'NOT_LOGGED'), value, 'NOT_LOGGED');
    expect(await prisma.mealCompletion.count({ where: { plannedMealId: value.meals[0].id } })).toBe(1);
    completion = await prisma.mealCompletion.findUnique({ where: { plannedMealId: value.meals[0].id } });
    expect(completion.status).toBe('NOT_LOGGED');
    expect(await prisma.mealPlan.findUnique({ where: { id: value.plan.id } })).toMatchObject({ updatedAt: planBefore.updatedAt });
    expect(await prisma.plannedMeal.findUnique({ where: { id: value.meals[0].id } })).toMatchObject({ updatedAt: mealBefore.updatedAt });
  }, 30000);

  it('enforces the real unique constraint, both cascades, and rollback of the transaction', async () => {
    const value = await fixture('constraints');
    const repo = repository();
    const returned = expectMealCompletionRecord(await put(repo, value, 'COMPLETED'), value, 'COMPLETED');
    const completion = await prisma.mealCompletion.findUnique({ where: { plannedMealId: value.meals[0].id } });
    expect(returned).toEqual(completion);

    await expect(prisma.mealCompletion.create({ data: {
      userId: value.user.id,
      plannedMealId: value.meals[0].id,
      recipeIdSnapshot: value.recipe.id,
      mealUpdatedAtSnapshot: value.meals[0].updatedAt,
      status: 'SKIPPED',
    } })).rejects.toMatchObject({ code: 'P2002' });

    const other = await fixture('cascade-user');
    expectMealCompletionRecord(await put(repo, other, 'SKIPPED'), other, 'SKIPPED');
    await prisma.user.delete({ where: { id: other.user.id } });
    expect(await prisma.mealCompletion.count({ where: { plannedMealId: other.meals[0].id } })).toBe(0);

    await prisma.plannedMeal.delete({ where: { id: value.meals[0].id } });
    expect(await prisma.mealCompletion.findUnique({ where: { plannedMealId: value.meals[0].id } })).toBeNull();

    // A database failure in the completion write must roll the whole transaction back.
    const third = await fixture('rollback');
    const broken = new AdherenceRepository({
      $transaction: (callback: (tx: any) => Promise<unknown>, options: unknown) => prisma.$transaction(async (tx: any) => {
        const proxy = new Proxy(tx, {
          get(target, key) {
            if (key === 'mealCompletion') return new Proxy(target.mealCompletion, {
              get(delegate, method) {
                if (['create', 'upsert', 'update'].includes(String(method))) {
                  return jest.fn().mockRejectedValue(new Error('synthetic completion write failure'));
                }
                const value = delegate[method];
                return typeof value === 'function' ? value.bind(delegate) : value;
              },
            });
            const value = target[key];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return callback(proxy);
      }),
    } as any, () => new Date(baseClock));
    await expect(put(broken, third, 'COMPLETED')).rejects.toThrow('synthetic completion write failure');
    expect(await prisma.mealCompletion.count({ where: { plannedMealId: third.meals[0].id } })).toBe(0);
  }, 30000);

  it('distinguishes a foreign meal from a missing meal without exposing ownership', async () => {
    const owner = await fixture('owner');
    const stranger = await fixture('stranger');
    const repo = repository();
    const foreign = await repo.setMealStatus(stranger.user.id, owner.meals[0].id, {
      planId: owner.plan.id,
      mealUpdatedAt: owner.meals[0].updatedAt.toISOString(),
      status: 'COMPLETED',
    }).catch((error) => error);
    const missing = await repo.setMealStatus(owner.user.id, '99999999-9999-4999-8999-999999999999', {
      planId: owner.plan.id,
      mealUpdatedAt: owner.meals[0].updatedAt.toISOString(),
      status: 'COMPLETED',
    }).catch((error) => error);

    expect(foreign).toMatchObject({ status: 404, response: expect.objectContaining({ code: 'ADHERENCE_MEAL_NOT_FOUND' }) });
    expect(missing).toMatchObject({ status: 404, response: expect.objectContaining({ code: 'ADHERENCE_MEAL_NOT_FOUND' }) });
    expect(foreign.response).toEqual(missing.response);
    expect(await prisma.mealCompletion.count({ where: { plannedMealId: owner.meals[0].id } })).toBe(0);
  });

  it('rejects a wrong plan, non-current plan, and stale meal token without writing', async () => {
    const value = await fixture('stale');
    const repo = repository();
    const wrongPlan = await repo.setMealStatus(value.user.id, value.meals[0].id, {
      planId: '33333333-3333-4333-8333-333333333333',
      mealUpdatedAt: value.meals[0].updatedAt.toISOString(),
      status: 'COMPLETED',
    }).catch((error) => error);
    expect(wrongPlan).toMatchObject({ status: 409, response: expect.objectContaining({ code: 'ADHERENCE_STALE' }) });

    await prisma.mealPlan.update({ where: { id: value.plan.id }, data: { isCurrent: false } });
    await expect(put(repo, value, 'SKIPPED')).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: 'ADHERENCE_STALE' }) });
    await prisma.mealPlan.update({ where: { id: value.plan.id }, data: { isCurrent: true } });

    const currentMeal = await prisma.plannedMeal.findUnique({ where: { id: value.meals[0].id } });
    const oldToken = currentMeal.updatedAt;
    const nextToken = new Date(oldToken.getTime() + 1);
    await prisma.plannedMeal.update({ where: { id: currentMeal.id }, data: { updatedAt: nextToken } });
    await expect(put(repo, value, 'COMPLETED', oldToken)).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: 'ADHERENCE_STALE' }) });
    expect(await prisma.mealCompletion.count({ where: { plannedMealId: value.meals[0].id } })).toBe(0);
  }, 30000);

  it('uses the stored UTC civil date and Buenos Aires day boundary for today, past, and future', async () => {
    const value = await fixture('day-boundary');
    const beforeBuenosAiresMidnight = repository('2026-10-20T02:59:59.999Z');
    const atBuenosAiresMidnight = repository('2026-10-20T03:00:00.000Z');

    await expect(put(beforeBuenosAiresMidnight, value, 'NOT_LOGGED')).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'MEAL_IN_FUTURE' }),
    });
    expectMealCompletionRecord(await put(atBuenosAiresMidnight, value, 'COMPLETED'), value, 'COMPLETED');

    const past = await fixture('past-current-week', { week: '2026-10-12', date: new Date('2026-10-13T00:00:00.000Z') });
    expectMealCompletionRecord(await put(repository(), past, 'SKIPPED'), past, 'SKIPPED');

    const future = await fixture('future', { week: '2026-10-26', date: new Date('2026-10-27T00:00:00.000Z') });
    await expect(put(repository(), future, 'NOT_LOGGED')).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'MEAL_IN_FUTURE' }),
    });
    expect(await prisma.mealCompletion.count({ where: { plannedMealId: future.meals[0].id } })).toBe(0);
  }, 30000);

  it('does not inherit completion after a meal replacement or plan regeneration', async () => {
    const replacement = await fixture('replacement');
    const repo = repository();
    const oldToken = replacement.meals[0].updatedAt;
    const replacementRecipe = await prisma.recipe.create({ data: {
      title: 'Replacement synthetic recipe', description: 'Synthetic', prepMinutes: 1, cookMinutes: 1,
      ingredients: [], instructions: ['Synthetic'],
    } });

    await prisma.plannedMeal.update({
      where: { id: replacement.meals[0].id },
      data: { recipeId: replacementRecipe.id, updatedAt: new Date(oldToken.getTime() + 1) },
    });
    await expect(put(repo, replacement, 'COMPLETED', oldToken)).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: 'ADHERENCE_STALE' }) });

    const regenerated = await fixture('regenerated');
    expectMealCompletionRecord(await put(repo, regenerated, 'COMPLETED'), regenerated, 'COMPLETED');
    await prisma.mealPlan.update({ where: { id: regenerated.plan.id }, data: { isCurrent: false } });
    const newPlan = await prisma.mealPlan.create({
      data: {
        userId: regenerated.user.id,
        startDate: regenerated.plan.startDate,
        endDate: regenerated.plan.endDate,
        version: 2,
        supersedesId: regenerated.plan.id,
        days: { create: [{
          day: 'TUESDAY', date: dayDate,
          meals: { create: [{ mealType: 'LUNCH', title: 'New meal', recipeId: regenerated.recipe.id, nutritionalValues: {} }] },
        }] },
      },
      include: { days: { include: { meals: true } } },
    });
    await expect(put(repo, regenerated, 'SKIPPED')).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: 'ADHERENCE_STALE' }) });
    expect(await prisma.mealCompletion.count({ where: { plannedMealId: newPlan.days[0].meals[0].id } })).toBe(0);
    expect(await prisma.mealCompletion.findUnique({ where: { plannedMealId: regenerated.meals[0].id } })).toMatchObject({ status: 'COMPLETED' });
  }, 30000);

  it.each(['replacement-before-put', 'put-before-replacement'])('serializes a meal replacement and PUT when %s queues first', async (first) => {
    const value = await fixture(`replacement-race-${first}`);
    const repo = repository();
    const nextRecipe = await prisma.recipe.create({ data: {
      title: `Concurrent replacement ${first}`, description: 'Synthetic', prepMinutes: 1, cookMinutes: 1,
      ingredients: [], instructions: ['Synthetic'],
    } });
    let release!: () => void;
    let announceLock!: () => void;
    const lockHeld = new Promise<void>((resolve) => { announceLock = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const blocker = prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "id" FROM "meal_plans" WHERE "id" = ${value.plan.id} FOR UPDATE`;
      announceLock();
      await blocked;
    });
    await lockHeld;

    const replacementFirst = first === 'replacement-before-put';
    let results: PromiseSettledResult<unknown>[] = [];
    try {
      const replacement = () => replaceMealInPlan(value, nextRecipe.id);
      const adherencePut = () => put(repo, value, 'COMPLETED');
      const firstAction = replacementFirst ? replacement() : adherencePut();
      await waitForBlockedTransactions(1);
      const secondAction = replacementFirst ? adherencePut() : replacement();
      await waitForBlockedTransactions(2);
      release();
      results = await Promise.allSettled([firstAction, secondAction]);
    } finally {
      release();
    }
    await blocker;

    const putResult = results[replacementFirst ? 1 : 0];
    const currentMeal = await prisma.plannedMeal.findUnique({ where: { id: value.meals[0].id } });
    const completion = await prisma.mealCompletion.findUnique({ where: { plannedMealId: value.meals[0].id } });
    expect(currentMeal.recipeId).toBe(nextRecipe.id);
    if (replacementFirst) {
      expect(putResult.status).toBe('rejected');
      expect((putResult as PromiseRejectedResult).reason).toMatchObject({ status: 409, response: expect.objectContaining({ code: 'ADHERENCE_STALE' }) });
      expect(completion).toBeNull();
    } else {
      expect(putResult.status).toBe('fulfilled');
      expectMealCompletionRecord((putResult as PromiseFulfilledResult<any>).value, value, 'COMPLETED');
      expect(completion).toMatchObject({ status: 'COMPLETED', recipeIdSnapshot: value.recipe.id });
      expect((putResult as PromiseFulfilledResult<any>).value).toEqual(completion);
      expect(completion.mealUpdatedAtSnapshot.getTime()).toBeLessThan(currentMeal.updatedAt.getTime());
    }
  }, 30000);

  it('bounds a blocked plan lock to five seconds and keeps lock_timeout transaction-local', async () => {
    const value = await fixture('lock-timeout');
    const repo = repository();
    const blocker = new Client({ connectionString: dbUrl, options: `-c search_path=${schema},public` });
    await blocker.connect();
    let transactionOpen = false;
    const releaseTimer = setTimeout(async () => {
      if (!transactionOpen) return;
      try {
        await blocker.query('COMMIT');
        transactionOpen = false;
      } catch {
        // The test assertion reports the operation outcome; cleanup also rolls back below.
      }
    }, 6500);

    try {
      await blocker.query('BEGIN');
      transactionOpen = true;
      await blocker.query('SELECT "id" FROM "meal_plans" WHERE "id" = $1 FOR UPDATE', [value.plan.id]);

      const startedAt = Date.now();
      const pending = put(repo, value, 'COMPLETED').then(
        (result) => ({ ok: true as const, result }),
        (error) => ({ ok: false as const, error }),
      );
      await waitForBlockedTransactions(1);
      const outcome = await pending;
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeGreaterThanOrEqual(4500);
      expect(elapsedMs).toBeLessThan(6000);
      expect(outcome).toMatchObject({
        ok: false,
        error: {
          status: 409,
          response: expect.objectContaining({ code: 'ADHERENCE_STALE' }),
        },
      });
      expect(await prisma.mealCompletion.count({ where: { plannedMealId: value.meals[0].id } })).toBe(0);

      const outsideTimeout = await prisma.$transaction(async (tx: any) =>
        tx.$queryRaw<Array<{ lock_timeout: string }>>`SHOW lock_timeout`);
      expect(outsideTimeout[0].lock_timeout).toBe('0');
    } finally {
      clearTimeout(releaseTimer);
      if (transactionOpen) await blocker.query('ROLLBACK').catch(() => undefined);
      await blocker.end();
    }
  }, 15000);

  it('invalidates old tokens when Recipe deletion runs before or after a completion', async () => {
    const deleteFirst = await fixture('recipe-delete-first', { mealCount: 2 });
    const oldTokens = deleteFirst.meals.map((meal: any) => meal.updatedAt);
    const recipes = new RecipeRepository(prisma);

    await recipes.delete(deleteFirst.recipe.id);
    const affected = await prisma.plannedMeal.findMany({ where: { id: { in: deleteFirst.meals.map((meal: any) => meal.id) } }, orderBy: { id: 'asc' } });
    expect(affected.every((meal: any) => meal.recipeId === null)).toBe(true);
    for (const meal of affected) {
      const prior = deleteFirst.meals.find((candidate: any) => candidate.id === meal.id);
      expect(meal.updatedAt.getTime()).toBeGreaterThan(prior.updatedAt.getTime());
    }
    await expect(put(repository(), deleteFirst, 'COMPLETED', oldTokens[0])).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: 'ADHERENCE_STALE' }) });

    const putFirst = await fixture('recipe-delete-after-put');
    expectMealCompletionRecord(await put(repository(), putFirst, 'COMPLETED'), putFirst, 'COMPLETED');
    const snapshot = await prisma.mealCompletion.findUnique({ where: { plannedMealId: putFirst.meals[0].id } });
    await recipes.delete(putFirst.recipe.id);
    const meal = await prisma.plannedMeal.findUnique({ where: { id: putFirst.meals[0].id } });
    expect(meal.recipeId).toBeNull();
    expect(meal.updatedAt.getTime()).toBeGreaterThan(snapshot.mealUpdatedAtSnapshot.getTime());
    expect(snapshot.recipeIdSnapshot).toBe(putFirst.recipe.id);
    expect(snapshot.recipeIdSnapshot).not.toBe(meal.recipeId);
  }, 30000);

  it('keeps legacy direct Recipe DELETE compatible by nulling references and advancing meal tokens', async () => {
    const value = await fixture('legacy-direct-recipe-delete', { mealCount: 2 });
    const previousTokens = new Map<string, number>(value.meals.map((meal: any) => [meal.id, meal.updatedAt.getTime()]));

    await prisma.$executeRaw`DELETE FROM "recipes" WHERE "id" = ${value.recipe.id}`;

    const affected = await prisma.plannedMeal.findMany({
      where: { id: { in: value.meals.map((meal: any) => meal.id) } },
      orderBy: { id: 'asc' },
    });
    expect(affected).toHaveLength(value.meals.length);
    for (const meal of affected) {
      expect(meal.recipeId).toBeNull();
      expect(meal.updatedAt.getTime()).toBeGreaterThan(previousTokens.get(meal.id)!);
    }
  }, 30000);

  it.each(['delete-before-put', 'put-before-delete'])('serializes concurrent Recipe delete and PUT when %s queues first', async (first) => {
    const value = await fixture(`race-${first}`);
    const repo = repository();
    const recipes = new RecipeRepository(prisma);
    let release!: () => void;
    let announceLock!: () => void;
    const lockHeld = new Promise<void>((resolve) => { announceLock = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const blocker = prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "id" FROM "meal_plans" WHERE "id" = ${value.plan.id} FOR UPDATE`;
      announceLock();
      await blocked;
    });
    await lockHeld;

    const deleteFirst = first === 'delete-before-put';
    let firstResult: PromiseSettledResult<unknown>[] = [];
    try {
      const firstAction = deleteFirst ? recipes.delete(value.recipe.id) : put(repo, value, 'COMPLETED');
      await waitForBlockedTransactions(1);
      const secondAction = deleteFirst ? put(repo, value, 'COMPLETED') : recipes.delete(value.recipe.id);
      await waitForBlockedTransactions(2);
      release();
      firstResult = await Promise.allSettled([firstAction, secondAction]);
    } finally {
      release();
    }
    await blocker;
    const putResult = firstResult[deleteFirst ? 1 : 0];
    expect(firstResult.every((result) => result.status === 'fulfilled' || (result.reason as any)?.status === 409)).toBe(true);

    const meal = await prisma.plannedMeal.findUnique({ where: { id: value.meals[0].id } });
    expect(meal.recipeId).toBeNull();
    const completion = await prisma.mealCompletion.findUnique({ where: { plannedMealId: value.meals[0].id } });
    if (deleteFirst) {
      expect(putResult?.status).toBe('rejected');
      expect((putResult as PromiseRejectedResult).reason).toMatchObject({ status: 409, response: expect.objectContaining({ code: 'ADHERENCE_STALE' }) });
      expect(completion).toBeNull();
    } else {
      expect(putResult?.status).toBe('fulfilled');
      expectMealCompletionRecord((putResult as PromiseFulfilledResult<any>).value, value, 'COMPLETED');
      expect(completion).toMatchObject({ status: 'COMPLETED', recipeIdSnapshot: value.recipe.id });
      expect((putResult as PromiseFulfilledResult<any>).value).toEqual(completion);
      expect(completion.mealUpdatedAtSnapshot.getTime()).toBeLessThan(meal.updatedAt.getTime());
    }
  }, 30000);
});
