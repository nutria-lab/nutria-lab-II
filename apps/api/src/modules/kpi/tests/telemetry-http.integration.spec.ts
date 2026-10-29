import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { PrismaPg } from '@prisma/adapter-pg';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../generated/prisma/client';
import { dateInBuenosAires } from '../../adherence/adherence.repository';
import { DIAGNOSTICS_FILE_NAME, type TelemetryDiagnostics } from '../cli/telemetry-cli';
import { canonicalPayloadBytes, freezeBatch } from '../kpi-batch';
import type { CollectionContext, KpiResult } from '../kpi-contract';
import { PrismaPublicationRepository } from '../prisma-publication.repository';
import { resolveFinalizeDate, windowForDate } from '../window/kpi-window';
import { KpiApiClient } from '../kpi-api-client';
import { applyMigrations, createDisposableSchema, describeIfKpiDb, kpiTestDatabaseUrl, type DisposableSchema } from './kpi-test-db.fixture';

const execute = promisify(execFile);
jest.setTimeout(120_000);

type SeedMeal = { status?: 'COMPLETED' | 'SKIPPED' | 'NOT_LOGGED'; stale?: boolean; date?: string };

describeIfKpiDb('Telemetry CLI -> full Nest application -> local PostgreSQL', () => {
  let app: INestApplication;
  let db: DisposableSchema;
  let baseUrl: string;
  let diagnosticsDir: string;
  let savedEnv: NodeJS.ProcessEnv;
  let reportDate: string;
  let publicationRepository: PrismaPublicationRepository;
  let publicationPrisma: PrismaClient;

  beforeAll(async () => {
    savedEnv = { ...process.env };
    db = await createDisposableSchema();
    await applyMigrations(db.client);
    const url = new URL(kpiTestDatabaseUrl()!);
    url.searchParams.set('options', `-c search_path=${db.schema},public`);
    Object.assign(process.env, {
      DATABASE_URL: url.toString(), DATABASE_URL_UNPOOLED: url.toString(),
      NODE_ENV: 'test', APP_ACCESS_PASSWORD: 'local-browser-password',
      KPI_ENV: 'dev', KPI_INSTRUMENTATION_ENABLED: 'true',
      KPI_INTERNAL_TOKEN: 'local-machine-token', JWT_SECRET: 'local-jwt-secret',
      OPENAI_API_KEY: 'local-unused-key', UNSPLASH_ACCESS_KEY: 'local-unused-key',
    });
    // Import only after overriding all runtime connection settings; never use the checkout's .env database.
    const { AppModule } = await import('../../../app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    publicationPrisma = new PrismaClient({ adapter: new PrismaPg(db.createPool({ max: 2 }), { schema: db.schema }) });
    await publicationPrisma.$connect();
    publicationRepository = new PrismaPublicationRepository(publicationPrisma as never);
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    diagnosticsDir = await mkdtemp(path.join(tmpdir(), 'nutria-telemetry-http-'));
    reportDate = resolveFinalizeDate(new Date()).date;
  });

  afterAll(async () => {
    await app?.close();
    await publicationPrisma?.$disconnect().catch(() => undefined);
    await db?.drop();
    if (diagnosticsDir) await rm(diagnosticsDir, { recursive: true, force: true });
    if (savedEnv) {
      for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
      Object.assign(process.env, savedEnv);
    }
  });

  beforeEach(async () => {
    await db.client.query('TRUNCATE kpi_http_event, kpi_dependency_event, kpi_health_sample, kpi_publication, users CASCADE');
  });

  async function seedPlan(
    userId: string,
    planId: string,
    options: { isCurrent?: boolean; version?: number; supersedesId?: string | null; startDate?: string } = {},
    meals: readonly SeedMeal[] = [],
  ) {
    const start = new Date(`${options.startDate ?? reportDate}T12:00:00.000Z`);
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
      [planId, userId, start, end, options.version ?? 1, options.isCurrent ?? true, options.supersedesId ?? null],
    );

    const grouped = new Map<string, SeedMeal[]>();
    for (const meal of meals) {
      const date = meal.date ?? reportDate;
      grouped.set(date, [...(grouped.get(date) ?? []), meal]);
    }
    let dayIndex = 0;
    for (const [date, dayMeals] of grouped) {
      const dayId = `${planId}-day-${dayIndex}`;
      const mealDate = new Date(`${date}T12:00:00.000Z`);
      const weekday = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'][dayIndex % 7];
      await db.client.query(
        `INSERT INTO meal_plan_days (id, "mealPlanId", day, date, "createdAt", "updatedAt")
         VALUES ($1, $2, $3::"DayOfWeek", $4, $4, $4)`,
        [dayId, planId, weekday, mealDate],
      );
      for (const [index, meal] of dayMeals.entries()) {
        const mealId = `${planId}-meal-${dayIndex}-${index}`;
        const updatedAt = new Date('2026-10-01T12:00:00.000Z');
        await db.client.query(
          `INSERT INTO planned_meals (id, "dayId", "mealType", title, "recipeId", "nutritionalValues", "createdAt", "updatedAt")
           VALUES ($1, $2, 'LUNCH'::"MealType", $3, NULL, '{}'::jsonb, $4, $5)`,
          [mealId, dayId, `synthetic ${index}`, mealDate, updatedAt],
        );
        if (meal.status) {
          await db.client.query(
            `INSERT INTO meal_completions
              (id, "userId", "plannedMealId", "recipeIdSnapshot", "mealUpdatedAtSnapshot", status, "createdAt", "updatedAt")
             VALUES ($1, $2, $3, NULL, $4, $5::"MealCompletionStatus", $4, $4)`,
            [
              `${mealId}-completion`, userId, mealId,
              meal.stale ? new Date(updatedAt.getTime() - 1) : updatedAt,
              meal.status,
            ],
          );
        }
      }
      dayIndex += 1;
    }
  }

  async function runCli(token = 'local-machine-token', databaseUrl = process.env.DATABASE_URL) {
    let exitCode = 0;
    try {
      await execute(process.execPath, [
        '--import', 'tsx', 'scripts/kpi/telemetry.ts',
        '--mode', 'sample', '--environment', 'dev', '--diagnostics-out', diagnosticsDir,
      ], {
        cwd: path.resolve(__dirname, '../../../..'),
        env: { ...process.env, KPI_API_BASE_URL: baseUrl, KPI_INTERNAL_TOKEN: token, DATABASE_URL: databaseUrl },
        timeout: 30_000,
      });
    } catch (error) {
      exitCode = typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : -1;
    }
    const diagnostics = JSON.parse(await readFile(path.join(diagnosticsDir, DIAGNOSTICS_FILE_NAME), 'utf8')) as TelemetryDiagnostics;
    return { exitCode, diagnostics };
  }

  it('stores health through HTTP without snapshots, preserving a repeated bucket', async () => {
    const first = await runCli();
    expect(first.exitCode).toBe(0);
    expect(first.diagnostics.sample).toMatchObject({ inserted: true, outcome: 'healthy', result: 'SAMPLE_RECORDED' });
    expect(first.diagnostics.error_codes).toEqual([]);
    expect(first.diagnostics).not.toHaveProperty('kpis');

    const samples = await db.client.query('SELECT * FROM kpi_health_sample');
    expect(samples.rows).toHaveLength(1);
    expect(samples.rows[0]).toMatchObject({ environment: 'dev', api_ok: true, database_ok: true, outcome: 'healthy' });

    const second = await runCli();
    expect(second.exitCode).toBe(0);
    expect(second.diagnostics.sample).toMatchObject({ inserted: false, result: 'SAMPLE_BUCKET_ALREADY_RECORDED' });
    expect((await db.client.query('SELECT * FROM kpi_health_sample')).rows).toEqual(samples.rows);
    expect((await db.client.query("SELECT to_regclass('kpi_snapshot') AS name")).rows[0].name).toBeNull();
  });

  it('does not need direct CLI database access when the backend accepts the sample', async () => {
    const result = await runCli('local-machine-token', 'postgresql://unused:unused@127.0.0.1:1/unused');
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics.sample).toMatchObject({ inserted: true, outcome: 'healthy' });
    expect((await db.client.query('SELECT count(*)::int AS n FROM kpi_health_sample')).rows[0].n).toBe(1);
  });

  it('fails with a wrong token and never bypasses the 401 through direct database writes', async () => {
    const result = await runCli('wrong-machine-token');
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.sample).toBeNull();
    expect(result.diagnostics.error_codes).toContain('KPI_API_HTTP_ERROR');
    expect((await db.client.query('SELECT count(*)::int AS n FROM kpi_health_sample')).rows[0].n).toBe(0);
    expect((await db.client.query("SELECT to_regclass('kpi_snapshot') AS name")).rows[0].name).toBeNull();
  });

  it('collects all eleven KPIs from current database rows without a snapshot table', async () => {
    const window = windowForDate(reportDate);
    const context = {
      contract_version: '1' as const, environment: 'dev' as const, date: reportDate,
      window_start: window.start.toISOString(), window_end: window.end.toISOString(), run_id: randomUUID(),
    };
    const insertEvent = () => db.client.query(
      `INSERT INTO kpi_http_event (id, environment, operation, started_at, finished_at, duration_ms, http_status, outcome)
       VALUES ($1, 'dev', 'GET /local-integration', $2, $3, 10, 200, 'success')`,
      [randomUUID(), new Date(window.start.getTime() + 3_600_000), new Date(window.start.getTime() + 3_600_010)],
    );
    await insertEvent();
    expect((await db.client.query("SELECT to_regclass('kpi_snapshot') AS name")).rows[0].name).toBeNull();
    const client = new KpiApiClient(baseUrl, 'local-machine-token');
    const first = await client.collect(context);
    expect(first).toHaveLength(11);
    expect(first.find(result => result.kpi_id === 'operations_count')?.value).toBe(1);
    expect(first.find(result => result.kpi_id === 'manual_recipes_count')).toMatchObject({ value: 0, quality: 'observed' });

    await insertEvent();
    const second = await client.collect({ ...context, run_id: randomUUID() });
    expect(second.find(result => result.kpi_id === 'operations_count')?.value).toBe(2);

  });

  it('queries real current plans and counts eligible today meals with only effective completions in the numerator', async () => {
    const collectionDate = dateInBuenosAires(new Date());
    const reportDateForCollection = addCivilDays(collectionDate, -1);
    const priorDate = reportDateForCollection;
    const futureDate = addCivilDays(collectionDate, 1);
    const userId = randomUUID();
    const oldPlanId = randomUUID();
    const currentPlanId = randomUUID();
    await seedPlan(userId, oldPlanId, {
      isCurrent: false, version: 1, startDate: priorDate,
    }, [{ status: 'COMPLETED', date: collectionDate }]);
    await seedPlan(userId, currentPlanId, {
      isCurrent: true, version: 2, supersedesId: oldPlanId, startDate: priorDate,
    }, [
      { status: 'COMPLETED', date: priorDate },
      { status: 'SKIPPED', date: priorDate },
      { status: 'NOT_LOGGED', date: priorDate },
      { status: 'COMPLETED', stale: true, date: priorDate },
      { status: 'COMPLETED', date: collectionDate },
      { status: 'COMPLETED', date: futureDate },
    ]);
    const window = windowForDate(reportDateForCollection);
    const context = {
      contract_version: '1' as const, environment: 'dev' as const, date: reportDateForCollection,
      window_start: window.start.toISOString(), window_end: window.end.toISOString(), run_id: randomUUID(),
    };

    const results = await new KpiApiClient(baseUrl, 'local-machine-token').collect(context);
    const adherence = results.find(({ kpi_id }) => kpi_id === 'adherence_rate');

    expect(results).toHaveLength(11);
    expect(context.date).toBe(reportDateForCollection);
    expect(context.date).not.toBe(collectionDate);
    expect(collectionDate).toBe(addCivilDays(reportDateForCollection, 1));
    expect(adherence).toMatchObject({ kpi_id: 'adherence_rate', value: 40, quality: 'observed', sample_count: 5 });
    expect((adherence as typeof adherence & { evidence?: Record<string, unknown> })?.evidence).toMatchObject({
      numerator: 2,
      denominator: 5,
      quality: 'observed',
      reason: null,
      collection_date: collectionDate,
      environment: 'dev',
    });
  });

  it('aggregates different user meal counts by meals in PostgreSQL rather than averaging user percentages', async () => {
    const collectionDate = dateInBuenosAires(new Date());
    const completedUser = randomUUID();
    const otherUser = randomUUID();
    await seedPlan(completedUser, randomUUID(), {}, [{ status: 'COMPLETED' }]);
    await seedPlan(otherUser, randomUUID(), {}, Array.from({ length: 9 }, () => ({ status: 'SKIPPED' as const })));
    const window = windowForDate(reportDate);
    const context = {
      contract_version: '1' as const, environment: 'dev' as const, date: reportDate,
      window_start: window.start.toISOString(), window_end: window.end.toISOString(), run_id: randomUUID(),
    };

    const result = (await new KpiApiClient(baseUrl, 'local-machine-token').collect(context))
      .find(({ kpi_id }) => kpi_id === 'adherence_rate');

    expect(result).toMatchObject({ value: 10, quality: 'observed', sample_count: 10 });
    expect((result as typeof result & { evidence?: Record<string, unknown> })?.evidence)
      .toMatchObject({ numerator: 1, denominator: 10, collection_date: collectionDate });
  });

  it('preserves an exact eighty-percent numerator and denominator from migrated PostgreSQL tables', async () => {
    const collectionDate = dateInBuenosAires(new Date());
    await seedPlan(randomUUID(), randomUUID(), {}, Array.from({ length: 40 }, (_, index) => ({
      status: index < 32 ? 'COMPLETED' as const : 'SKIPPED' as const,
    })));
    const window = windowForDate(reportDate);
    const context = {
      contract_version: '1' as const, environment: 'dev' as const, date: reportDate,
      window_start: window.start.toISOString(), window_end: window.end.toISOString(), run_id: randomUUID(),
    };

    const result = (await new KpiApiClient(baseUrl, 'local-machine-token').collect(context))
      .find(({ kpi_id }) => kpi_id === 'adherence_rate');

    expect(result).toMatchObject({ value: 80, quality: 'observed', sample_count: 40 });
    expect((result as typeof result & { evidence?: Record<string, unknown> })?.evidence)
      .toMatchObject({ numerator: 32, denominator: 40, collection_date: collectionDate, environment: 'dev' });
  });

  it('round-trips the eleven-result frozen batch and evidence through real PostgreSQL while leaving a legacy ten-result batch unchanged', async () => {
    const measuredAt = new Date().toISOString();
    const collectionDate = dateInBuenosAires(new Date(measuredAt));
    const reportDateForBatch = addCivilDays(collectionDate, -1);
    const legacyIds = [
      'operations_count', 'error_rate', 'latency_p95_ms', 'health_status',
      'last_success_age_seconds', 'timeout_rate', 'dependency_error_rate', 'availability_rate',
      'initial_plans_count', 'manual_recipes_count',
    ];
    const evidence = {
      numerator: 32,
      denominator: 40,
      quality: 'observed' as const,
      reason: null,
      collection_date: collectionDate,
      measured_at: measuredAt,
      environment: 'dev' as const,
    };
    const makeResult = (kpi_id: string, includeEvidence = false) => ({
      kpi_id: kpi_id as never,
      value: includeEvidence ? 80 : 0,
      quality: 'observed' as const,
      reason: null,
      sample_count: includeEvidence ? 40 : 0,
      measured_at: evidence.measured_at,
      ...(includeEvidence ? { evidence } : {}),
    } as KpiResult & { evidence?: typeof evidence });
    const window = windowForDate(reportDateForBatch);
    const currentContext: CollectionContext = {
      contract_version: '1', environment: 'dev', date: reportDateForBatch,
      window_start: window.start.toISOString(), window_end: window.end.toISOString(), run_id: randomUUID(),
    };
    const currentBatch = freezeBatch(currentContext, [
      ...legacyIds.map((id) => makeResult(id)),
      makeResult('adherence_rate', true),
    ]);
    const currentReservation = {
      environment: 'dev' as const, date: reportDateForBatch, runId: currentContext.run_id,
      sourceCommit: 'a'.repeat(40), retryChainId: randomUUID(),
    };
    await publicationRepository.reservePublication(currentReservation);
    await publicationRepository.freezeBatchConditionally(
      currentContext.run_id, currentBatch, canonicalPayloadBytes(currentBatch.measurements),
    );

    const persistedCurrent = await publicationRepository.getPublication('dev', reportDateForBatch);
    const adherenceDiagnostic = persistedCurrent.frozenBatch?.diagnostics.find(({ kpi_id }) => kpi_id === 'adherence_rate');
    expect(persistedCurrent.frozenBatch?.measurements).toHaveLength(11);
    expect(persistedCurrent.payloadSha256).toBe(currentBatch.payload_sha256);
    expect(JSON.parse(persistedCurrent.frozenPayload!.toString('utf8'))).toHaveLength(11);
    expect(persistedCurrent.frozenPayload!.toString('utf8')).not.toContain('numerator');

    const legacyContext: CollectionContext = {
      ...currentContext, environment: 'qa', run_id: randomUUID(),
    };
    const legacyBatch = freezeBatch(legacyContext, legacyIds.map((id) => makeResult(id)));
    await publicationRepository.reservePublication({
      ...currentReservation, environment: 'qa', runId: legacyContext.run_id, retryChainId: randomUUID(),
    });
    await publicationRepository.freezeBatchConditionally(
      legacyContext.run_id, legacyBatch, canonicalPayloadBytes(legacyBatch.measurements),
    );

    const persistedLegacy = await publicationRepository.getPublication('qa', reportDateForBatch);
    expect(persistedLegacy.frozenBatch?.measurements).toEqual(legacyBatch.measurements);
    expect(persistedLegacy.frozenBatch?.diagnostics).toEqual(legacyBatch.diagnostics);
    expect(persistedLegacy.frozenBatch?.measurements).toHaveLength(10);
    expect(persistedLegacy.frozenBatch?.measurements.some(({ kpi_id }) => kpi_id === 'adherence_rate')).toBe(false);
    expect(persistedLegacy.payloadSha256).toBe(legacyBatch.payload_sha256);

    expect(currentContext.date).not.toBe(collectionDate);
    expect(collectionDate).toBe(addCivilDays(currentContext.date, 1));
    expect(adherenceDiagnostic).toMatchObject({ kpi_id: 'adherence_rate', sample_count: 40, evidence });
  });
});

function addCivilDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
