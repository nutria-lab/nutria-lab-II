import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { DataKpiLogger } from '../data-kpi.logger';
import type { CollectionContext } from '../kpi-contract';
import { selectAutomaticArgentinaKpiDate } from '../kpi-window';
import { applyMigrations, createDisposableSchema, describeIfKpiDb, kpiTestDatabaseUrl, type DisposableSchema } from './kpi-test-db.fixture';

jest.setTimeout(120_000);

const measuredInstant = new Date('2026-10-10T06:04:05.006Z');
const reportDate = selectAutomaticArgentinaKpiDate({ now: () => measuredInstant });

describeIfKpiDb('DataKpiLogger -> disposable local PostgreSQL', () => {
  let db: DisposableSchema;
  let prisma: PrismaClient;

  beforeAll(async () => {
    db = await createDisposableSchema();
    await applyMigrations(db.client);
    prisma = new PrismaClient({
      adapter: new PrismaPg(db.createPool({ max: 2 }), { schema: db.schema }),
    });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await db?.drop();
  });

  beforeEach(async () => {
    await db.client.query('TRUNCATE users CASCADE');
  });

  it('counts only report date D on the current plan and excludes prior/future days and stale completions', async () => {
    const userId = randomUUID();
    const oldPlanId = randomUUID();
    const currentPlanId = randomUUID();
    const previousDate = addCivilDays(reportDate, -1);
    const previousWeekDate = addCivilDays(reportDate, -7);
    const followingDate = addCivilDays(reportDate, 1);
    await seedPlan(randomUUID(), randomUUID(), {
      isCurrent: true,
      version: 1,
      startDate: previousWeekDate,
      supersedesId: null,
    }, [{ date: previousWeekDate }]);
    await seedPlan(userId, oldPlanId, {
      isCurrent: false,
      version: 1,
      startDate: previousDate,
      supersedesId: null,
    }, [{ date: reportDate, status: 'COMPLETED' }]);
    await seedPlan(userId, currentPlanId, {
      isCurrent: true,
      version: 2,
      startDate: previousDate,
      supersedesId: oldPlanId,
    }, [
      { date: previousDate },
      { date: reportDate, status: 'COMPLETED' },
      { date: reportDate, status: 'COMPLETED', recipeSnapshot: 'stale-recipe' },
      { date: reportDate, status: 'COMPLETED', updatedAtSnapshotIsStale: true },
      { date: reportDate, status: 'SKIPPED' },
      { date: followingDate },
    ]);

    const context: CollectionContext = {
      contract_version: '1',
      date: reportDate,
      environment: 'qa',
      window_start: '2026-10-09T03:00:00.000Z',
      window_end: '2026-10-10T00:00:00.000Z',
      run_id: randomUUID(),
    };
    const result = (await new DataKpiLogger(prisma as never, () => measuredInstant).collect(context))
      .find(({ kpi_id }) => kpi_id === 'adherence_rate');

    expect(result).toMatchObject({ value: 25, quality: 'observed', reason: null, sample_count: 4 });
    expect(result && 'evidence' in result ? result.evidence : undefined).toMatchObject({
      numerator: 1,
      denominator: 4,
      quality: 'observed',
      reason: null,
      collection_date: reportDate,
      environment: 'qa',
    });
  });

  it('applies statement_timeout locally in a PostgreSQL transaction, cancels work, and resets it afterward', async () => {
    await db.client.query('BEGIN');
    try {
      await db.client.query("SET LOCAL statement_timeout = '50ms'");
      const configured = await db.client.query<{ statement_timeout: string }>('SHOW statement_timeout');
      expect(configured.rows[0].statement_timeout).toBe('50ms');
      await expect(db.client.query('SELECT pg_sleep(0.2)')).rejects.toMatchObject({ code: '57014' });
    } finally {
      await db.client.query('ROLLBACK');
    }
    const restored = await db.client.query<{ statement_timeout: string }>('SHOW statement_timeout');
    expect(restored.rows[0].statement_timeout).not.toBe('50ms');
  });

  it('bounds a blocked adherence query and does not leak the timeout to the next collection', async () => {
    await db.client.query('BEGIN');
    let timeout: NodeJS.Timeout | undefined;
    let collection: ReturnType<DataKpiLogger['collect']> | undefined;
    try {
      await db.client.query('LOCK TABLE planned_meals IN ACCESS EXCLUSIVE MODE');
      const startedAt = Date.now();
      collection = new DataKpiLogger(prisma as never, () => measuredInstant).collect(contextFor(reportDate));
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('DataKpiLogger exceeded the 7-second lock deadline')), 7_000);
      });
      const results = await Promise.race([collection, deadline]);
      const elapsedMs = Date.now() - startedAt;
      const adherence = results.find(({ kpi_id }) => kpi_id === 'adherence_rate');

      expect(elapsedMs).toBeLessThan(7_000);
      expect(adherence).toMatchObject({ value: null, quality: 'unavailable', reason: 'SOURCE_UNAVAILABLE' });
    } finally {
      if (timeout) clearTimeout(timeout);
      await db.client.query('ROLLBACK');
      // If a broken implementation missed the deadline, let the released lock unblock
      // its query while preventing a late rejection from becoming an unhandled one.
      void collection?.catch(() => undefined);
    }

    const afterRelease = await withinDeadline(
      new DataKpiLogger(prisma as never, () => measuredInstant).collect(contextFor(reportDate)),
      7_000,
    );
    const adherenceAfterRelease = afterRelease.find(({ kpi_id }) => kpi_id === 'adherence_rate');
    expect(adherenceAfterRelease).toMatchObject({
      value: null,
      quality: 'unavailable',
      reason: 'NO_ELIGIBLE_MEALS',
    });
  });

  async function seedPlan(
    userId: string,
    planId: string,
    options: { isCurrent: boolean; version: number; startDate: string; supersedesId: string | null },
    meals: readonly {
      date: string;
      status?: 'COMPLETED' | 'SKIPPED';
      recipeSnapshot?: string | null;
      updatedAtSnapshotIsStale?: boolean;
    }[],
  ) {
    const start = new Date(`${options.startDate}T12:00:00.000Z`);
    const end = new Date(start.getTime() + 6 * 86_400_000);
    await db.client.query(
      `INSERT INTO users (id, email, "passwordHash", "createdAt", "updatedAt")
       VALUES ($1, $2, 'synthetic-test-hash', $3, $3) ON CONFLICT (id) DO NOTHING`,
      [userId, `${userId}@example.test`, start],
    );
    await db.client.query(
      `INSERT INTO meal_plans
        (id, "userId", "startDate", "endDate", "createdAt", "updatedAt", version, "isCurrent", "supersedesId")
       VALUES ($1, $2, $3, $4, $3, $3, $5, $6, $7)`,
      [planId, userId, start, end, options.version, options.isCurrent, options.supersedesId],
    );

    const grouped = new Map<string, typeof meals[number][]>();
    for (const meal of meals) grouped.set(meal.date, [...(grouped.get(meal.date) ?? []), meal]);
    let dayIndex = 0;
    for (const [date, dayMeals] of grouped) {
      const dateInstant = new Date(`${date}T12:00:00.000Z`);
      const weekday = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][dateInstant.getUTCDay()];
      const dayId = `${planId}-day-${dayIndex}`;
      await db.client.query(
        `INSERT INTO meal_plan_days (id, "mealPlanId", day, date, "createdAt", "updatedAt")
         VALUES ($1, $2, $3::"DayOfWeek", $4, $4, $4)`,
        [dayId, planId, weekday, dateInstant],
      );
      for (const [mealIndex, meal] of dayMeals.entries()) {
        const mealId = `${planId}-meal-${dayIndex}-${mealIndex}`;
        const updatedAt = new Date('2026-10-01T12:00:00.000Z');
        await db.client.query(
          `INSERT INTO planned_meals (id, "dayId", "mealType", title, "recipeId", "nutritionalValues", "createdAt", "updatedAt")
           VALUES ($1, $2, 'LUNCH'::"MealType", $3, NULL, '{}'::jsonb, $4, $5)`,
          [mealId, dayId, `synthetic ${mealIndex}`, dateInstant, updatedAt],
        );
        if (meal.status) {
          const snapshotUpdatedAt = meal.updatedAtSnapshotIsStale
            ? new Date(updatedAt.getTime() - 1)
            : updatedAt;
          await db.client.query(
            `INSERT INTO meal_completions
              (id, "userId", "plannedMealId", "recipeIdSnapshot", "mealUpdatedAtSnapshot", status, "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6::"MealCompletionStatus", $5, $5)`,
            [
              `${mealId}-completion`, userId, mealId, meal.recipeSnapshot ?? null,
              snapshotUpdatedAt, meal.status,
            ],
          );
        }
      }
      dayIndex += 1;
    }
  }
});

function contextFor(date: string): CollectionContext {
  return {
    contract_version: '1',
    date,
    environment: 'qa',
    window_start: `${date}T03:00:00.000Z`,
    window_end: `${addCivilDays(date, 1)}T03:00:00.000Z`,
    run_id: randomUUID(),
  };
}

async function withinDeadline<T>(work: Promise<T>, deadlineMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Work exceeded ${deadlineMs} ms`)), deadlineMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    void work.catch(() => undefined);
  }
}

function addCivilDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
