/**
 * NUT-114 — Block 2 (TDD red first): synthetic loader against a disposable LOCAL PostgreSQL.
 *
 * Runs only when SEED_TEST_DATABASE_URL is set; never falls back to DATABASE_URL and refuses any host other than
 * localhost / 127.0.0.1 / ::1. Every case creates a private random schema, applies prisma/migrations in order (one
 * transaction each) and drops the schema afterwards (pattern of adherence.persistence.integration.spec.ts).
 *
 * Uses the API declared in seed-synthetic.load.spec.ts:
 *   loadSynthetic(client, { dataset, now, batchSize, log? }): Promise<LoadReport>; SeedPhaseError { phase; code; batch? }.
 * Volume: 60 users, batch 500. The KPI cases use the real DataKpiLogger with the SAME fixed instant for the seed and
 * for the KPI clock, and the context window from resolveArgentinaKpiWindow:
 *   (a) now 2026-11-12T01:00:00Z (Wed 2026-11-11 22:00 ART), date 2026-11-11 -> adherence N=4, C=0 (value 0);
 *   (b) now 2026-11-11T18:00:00Z (Wed 2026-11-11 15:00 ART), date 2026-11-10 -> adherence N=4, C=2 (value 50);
 *   both: 0 eligible meals on that date outside 00001; manual_recipes_count = 0 and initial_plans_count = 0.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client, Pool } from 'pg';
import { PrismaClient } from '@/generated/prisma/client';
import { DataKpiLogger } from '@/modules/kpi/data-kpi.logger';
import type { CollectionContext, KpiResult } from '@/modules/kpi/kpi-contract';
import { resolveArgentinaKpiWindow, selectAutomaticArgentinaKpiDate } from '@/modules/kpi/kpi-window';
import { synthId } from '../seed-data';
import { SyntheticDataset, generateSyntheticDataset } from '../../../prisma/synthetic/generate';
import { SeedPhaseError, loadSynthetic } from '../../../prisma/synthetic/load';

jest.setTimeout(300_000);

// ---------- expected API shapes (declared locally so this spec type-checks on its own) ----------

interface SpecSeedPhaseError extends Error { phase: string; code: string; batch?: number }
interface SpecLoadReport {
  bulk: { ok: true; counts: Record<string, number> };
  currentWeek: { ok: true; counts: Record<string, number> } | { ok: false; error: SpecSeedPhaseError };
}

// ---------- local-only database guard ----------

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];

/** Only SEED_TEST_DATABASE_URL counts; DATABASE_URL is never a fallback. */
function resolveSeedTestDbUrl(env: Record<string, string | undefined>): string | undefined {
  return env.SEED_TEST_DATABASE_URL || undefined;
}

function assertLocalTestUrl(url: string): void {
  if (!LOCAL_HOSTS.includes(new URL(url).hostname)) {
    throw new Error('SEED_TEST_DATABASE_URL must point to a disposable local PostgreSQL instance');
  }
}

describe('SEED_TEST_DATABASE_URL guard (always runs)', () => {
  it('never falls back to DATABASE_URL and rejects non-local hosts', () => {
    expect(resolveSeedTestDbUrl({ DATABASE_URL: 'postgresql://x:y@localhost:5432/db' })).toBeUndefined();
    expect(() => assertLocalTestUrl('postgresql://x:y@ep-foo-123.us-east-2.aws.neon.tech/neondb')).toThrow(/local/);
    expect(() => assertLocalTestUrl('postgresql://x:y@10.0.0.5:5432/db')).toThrow(/local/);
    expect(() => assertLocalTestUrl('postgresql://x:y@127.0.0.1:5432/db')).not.toThrow();
    expect(() => assertLocalTestUrl('postgresql://x:y@[::1]:5432/db')).not.toThrow();
  });
});

const dbUrl = resolveSeedTestDbUrl(process.env);
const describeWithDb = dbUrl ? describe : describe.skip;

interface IsolatedDb { prisma: any; close(): Promise<void> }

async function openIsolatedDb(): Promise<IsolatedDb> {
  assertLocalTestUrl(dbUrl!);
  const schema = `nut114_it_${randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: dbUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const options = `-c search_path=${schema},public`;
  let pool: Pool | undefined;
  let prisma: any;
  try {
    const migrator = new Client({ connectionString: dbUrl, options });
    await migrator.connect();
    try {
      const migrationsDir = path.resolve(__dirname, '../../../prisma/migrations');
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
  } catch (error) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await admin.end().catch(() => undefined);
    throw error;
  }
  return {
    prisma,
    async close() {
      await prisma?.$disconnect().catch(() => undefined);
      await pool?.end().catch(() => undefined);
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    },
  };
}

async function withIsolatedDb(body: (prisma: any) => Promise<void>): Promise<void> {
  const db = await openIsolatedDb();
  try {
    await body(db.prisma);
  } finally {
    await db.close();
  }
}

// ---------- fixtures ----------

const USERS = 60;
const BATCH = 500;
const DEMO_HASH = '$2b$04$QL597mIXc6JauPDhUTUPR.uUjvBlSb9NxRWu5xn4egJ78KrMILTNK';
const WED = new Date('2026-11-11T15:00:00.000Z');
const DEMO_USER_ID = synthId('users', 1);
const DELEGATES = {
  ingredients: 'ingredient', users: 'user', profiles: 'nutritionProfile', recipes: 'recipe', plans: 'mealPlan',
  days: 'mealPlanDay', meals: 'plannedMeal', completions: 'mealCompletion', shoppingChecks: 'shoppingItemCheck',
} as const;
type SpecTable = keyof typeof DELEGATES;

const datasetFor = (now: Date): SyntheticDataset =>
  generateSyntheticDataset({ users: USERS, demoPasswordHash: DEMO_HASH, now });

async function load(client: unknown, now: Date): Promise<SpecLoadReport> {
  return (await loadSynthetic(client as never, { dataset: datasetFor(now), now, batchSize: BATCH })) as SpecLoadReport;
}

async function tableCounts(prisma: any): Promise<Record<SpecTable, number>> {
  const entries = await Promise.all((Object.keys(DELEGATES) as SpecTable[])
    .map(async (table) => [table, await prisma[DELEGATES[table]].count()] as const));
  return Object.fromEntries(entries) as Record<SpecTable, number>;
}

async function scalar(prisma: any, sql: string, ...params: unknown[]): Promise<number> {
  const rows = await prisma.$queryRawUnsafe(sql, ...params);
  return Number(Object.values(rows[0])[0]);
}

/** Wraps the real client so one model's createMany throws exactly once. */
function failingOnce(prisma: any, delegate: string): unknown {
  let failed = false;
  const wrapped: Record<string, unknown> = {};
  for (const name of Object.values(DELEGATES)) {
    const real = prisma[name];
    wrapped[name] = {
      findMany: (args: unknown) => real.findMany(args),
      findFirst: (args: unknown) => real.findFirst(args),
      count: (args: unknown) => real.count(args),
      createMany: (args: unknown) => {
        if (name === delegate && !failed) {
          failed = true;
          return Promise.reject(new Error('injected transient failure'));
        }
        return real.createMany(args);
      },
    };
  }
  return wrapped;
}

function kpiByid(results: readonly KpiResult[], id: KpiResult['kpi_id']): KpiResult {
  const result = results.find((r) => r.kpi_id === id);
  if (!result) throw new Error(`missing KPI ${id}`);
  return result;
}

async function collectKpis(prisma: any, now: Date, date: string): Promise<readonly KpiResult[]> {
  const clock = { now: () => now };
  expect(selectAutomaticArgentinaKpiDate(clock)).toBe(date);
  const context: CollectionContext = {
    contract_version: '1',
    environment: 'dev',
    run_id: randomUUID(),
    ...resolveArgentinaKpiWindow(date, clock),
  };
  return new DataKpiLogger(prisma as never, () => now).collect(context);
}

const ELIGIBLE_ON_DATE = `
  SELECT COUNT(*) AS n
  FROM "meal_plans" p
  JOIN "meal_plan_days" d ON d."mealPlanId" = p."id"
  JOIN "planned_meals" pm ON pm."dayId" = d."id"
  WHERE p."isCurrent" = true AND d."date"::date = $1::date AND p."userId" <> $2`;
const ELIGIBLE_ON_DATE_FOR_USER = ELIGIBLE_ON_DATE.replace('p."userId" <> $2', 'p."userId" = $2');

// ---------- tests ----------

describeWithDb('synthetic seed on isolated local PostgreSQL', () => {
  it('loads twice with stable counts; FK without orphans; every past plan has 7 days x 4 meals; snapshots valid', async () => {
    await withIsolatedDb(async (prisma) => {
      const dataset = datasetFor(WED);
      const first = await load(prisma, WED);
      expect(first.currentWeek.ok).toBe(true);
      const afterFirst = await tableCounts(prisma);
      expect(afterFirst.users).toBe(USERS);
      expect(afterFirst.plans).toBe(USERS + 1);
      expect(afterFirst.days).toBe(7 * (USERS + 1));
      expect(afterFirst.meals).toBe(28 * (USERS + 1));
      expect(afterFirst.ingredients).toBe(dataset.ingredients.length);
      expect(afterFirst.recipes).toBe(dataset.recipes.length);

      const second = await load(prisma, WED);
      expect(second.bulk).toEqual(first.bulk);
      expect(await tableCounts(prisma)).toEqual(afterFirst);

      const badPlans = await scalar(prisma, `
        SELECT COUNT(*) FROM (
          SELECT p.id FROM "meal_plans" p
          LEFT JOIN "meal_plan_days" d ON d."mealPlanId" = p.id
          LEFT JOIN "planned_meals" pm ON pm."dayId" = d.id
          WHERE p.id LIKE '5eed0003-%'
          GROUP BY p.id
          HAVING COUNT(DISTINCT d.id) <> 7 OR COUNT(pm.id) <> 28
        ) t`);
      expect(badPlans).toBe(0);
      const orphans = await scalar(prisma, `
        SELECT
          (SELECT COUNT(*) FROM "nutrition_profiles" x LEFT JOIN "users" u ON u.id = x."userId" WHERE u.id IS NULL)
        + (SELECT COUNT(*) FROM "meal_plans" x LEFT JOIN "users" u ON u.id = x."userId" WHERE u.id IS NULL)
        + (SELECT COUNT(*) FROM "meal_plan_days" x LEFT JOIN "meal_plans" p ON p.id = x."mealPlanId" WHERE p.id IS NULL)
        + (SELECT COUNT(*) FROM "planned_meals" x LEFT JOIN "meal_plan_days" d ON d.id = x."dayId" WHERE d.id IS NULL)
        + (SELECT COUNT(*) FROM "planned_meals" x LEFT JOIN "recipes" r ON r.id = x."recipeId" WHERE x."recipeId" IS NOT NULL AND r.id IS NULL)
        + (SELECT COUNT(*) FROM "meal_completions" x LEFT JOIN "planned_meals" pm ON pm.id = x."plannedMealId" WHERE pm.id IS NULL)
        + (SELECT COUNT(*) FROM "shopping_item_checks" x LEFT JOIN "meal_plans" p ON p.id = x."planId" WHERE p.id IS NULL)`);
      expect(orphans).toBe(0);
      const crossUser = await scalar(prisma, `
        SELECT
          (SELECT COUNT(*) FROM "meal_completions" mc
             JOIN "planned_meals" pm ON pm.id = mc."plannedMealId"
             JOIN "meal_plan_days" d ON d.id = pm."dayId"
             JOIN "meal_plans" p ON p.id = d."mealPlanId"
           WHERE p."userId" <> mc."userId")
        + (SELECT COUNT(*) FROM "shopping_item_checks" c JOIN "meal_plans" p ON p.id = c."planId" WHERE p."userId" <> c."userId")`);
      expect(crossUser).toBe(0);
      const staleSnapshots = await scalar(prisma, `
        SELECT COUNT(*) FROM "meal_completions" mc JOIN "planned_meals" pm ON pm.id = mc."plannedMealId"
        WHERE mc."recipeIdSnapshot" IS DISTINCT FROM pm."recipeId" OR mc."mealUpdatedAtSnapshot" <> pm."updatedAt"`);
      expect(staleSnapshots).toBe(0);
    });
  });

  it('a transient failure reports phase and batch; the next run completes the load', async () => {
    await withIsolatedDb(async (prisma) => {
      let caught: unknown;
      try {
        await load(failingOnce(prisma, 'plannedMeal'), WED);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SeedPhaseError);
      const error = caught as SpecSeedPhaseError;
      expect({ phase: error.phase, code: error.code, batch: error.batch }).toEqual({ phase: 'meals', code: 'batch_failed', batch: 1 });
      expect((await tableCounts(prisma)).completions).toBe(0);

      const report = await load(prisma, WED);
      expect(report.currentWeek.ok).toBe(true);
      const counts = await tableCounts(prisma);
      expect({ plans: counts.plans, days: counts.days, meals: counts.meals })
        .toEqual({ plans: USERS + 1, days: 7 * (USERS + 1), meals: 28 * (USERS + 1) });
    });
  });

  it.each([
    { label: '(a) report date = today, after the 21:00 cut-off', now: '2026-11-12T01:00:00.000Z', date: '2026-11-11', numerator: 0, value: 0 },
    { label: '(b) report date = yesterday, before the cut-off', now: '2026-11-11T18:00:00.000Z', date: '2026-11-10', numerator: 2, value: 50 },
  ])('KPI isolation $label: only the 4 meals of 00001 count', async ({ now, date, numerator, value }) => {
    await withIsolatedDb(async (prisma) => {
      const instant = new Date(now);
      const report = await load(prisma, instant);
      expect(report.currentWeek.ok).toBe(true);

      expect(await scalar(prisma, ELIGIBLE_ON_DATE, date, DEMO_USER_ID)).toBe(0);
      expect(await scalar(prisma, ELIGIBLE_ON_DATE_FOR_USER, date, DEMO_USER_ID)).toBe(4);

      const results = await collectKpis(prisma, instant, date);
      const adherence = kpiByid(results, 'adherence_rate');
      expect(adherence.evidence).toMatchObject({ numerator, denominator: 4, quality: 'observed', collection_date: date });
      expect(adherence).toMatchObject({ value, quality: 'observed', sample_count: 4 });
      expect(kpiByid(results, 'manual_recipes_count')).toMatchObject({ value: 0, quality: 'observed' });
      expect(kpiByid(results, 'initial_plans_count')).toMatchObject({ value: 0, quality: 'observed' });
    });
  });
});
