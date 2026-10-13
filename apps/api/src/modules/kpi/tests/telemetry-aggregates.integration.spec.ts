// NUT-85 T2 — F1–F6 sobre Postgres real (design D12: agregados en SQL, percentile_disc es la fuente de verdad).
// Sólo KPI_TEST_DATABASE_URL; skip si falta; falla si el host no es local. Schema descartable por suite.
import { randomUUID } from 'crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { buildTelemetryResults } from '../calc/telemetry-formulas';
import type { KpiResult } from '../kpi-contract';
import { TelemetryRepository } from '../repo/telemetry.repository';
import { DisposableSchema, applyMigrations, createDisposableSchema, describeIfKpiDb } from './kpi-test-db.fixture';

jest.setTimeout(60_000);

const WINDOW = {
  start: new Date('2026-10-09T03:00:00.000Z'),
  end: new Date('2026-10-10T00:00:00.000Z'),
};
const IN_WINDOW_MS = Date.parse('2026-10-09T12:00:00.000Z');
const MINUTE_MS = 60_000;
const iso = (ms: number): string => new Date(ms).toISOString();

type Env = 'dev' | 'qa' | 'prod';
type HttpOutcome = 'pending' | 'success' | 'client_error' | 'server_error' | 'network_error' | 'timeout' | 'other';

const STATUS_BY_OUTCOME: Record<Exclude<HttpOutcome, 'pending'>, number | null> = {
  success: 200,
  client_error: 404,
  server_error: 500,
  network_error: null,
  timeout: 504,
  other: 302,
};

describeIfKpiDb('telemetry-aggregates (integración Postgres)', () => {
  let db: DisposableSchema;
  let prisma: PrismaClient;
  let repo: TelemetryRepository;

  beforeAll(async () => {
    db = await createDisposableSchema();
    await applyMigrations(db.client);
    prisma = new PrismaClient({ adapter: new PrismaPg(db.createPool({ max: 2 })) });
    repo = new TelemetryRepository(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await db?.drop();
  });

  beforeEach(async () => {
    await db.client.query('TRUNCATE kpi_http_event, kpi_dependency_event, kpi_health_sample');
  });

  async function insertHttp(
    outcome: HttpOutcome,
    opts: { env?: Env; finishedAtMs?: number; durationMs?: number } = {},
  ): Promise<void> {
    const finished = opts.finishedAtMs ?? IN_WINDOW_MS;
    const duration = opts.durationMs ?? 10;
    if (outcome === 'pending') {
      await db.client.query(
        `INSERT INTO kpi_http_event (id, environment, operation, started_at, outcome) VALUES ($1, $2, 'GET /x', $3, 'pending')`,
        [randomUUID(), opts.env ?? 'dev', iso(finished)],
      );
      return;
    }
    await db.client.query(
      `INSERT INTO kpi_http_event (id, environment, operation, started_at, finished_at, duration_ms, http_status, outcome)
       VALUES ($1, $2, 'GET /x', $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        opts.env ?? 'dev',
        iso(finished - Math.ceil(duration)),
        iso(finished),
        duration,
        STATUS_BY_OUTCOME[outcome],
        outcome,
      ],
    );
  }

  async function insertDependency(
    outcome: 'pending' | 'success' | 'error' | 'timeout',
    opts: { env?: Env; finishedAtMs?: number } = {},
  ): Promise<void> {
    const finished = opts.finishedAtMs ?? IN_WINDOW_MS;
    const terminal = outcome !== 'pending';
    await db.client.query(
      `INSERT INTO kpi_dependency_event (id, environment, operation_id, dependency, attempt, started_at, finished_at, duration_ms, outcome)
       VALUES ($1, $2, $3, 'gemini', 1, $4, $5, $6, $7)`,
      [
        randomUUID(),
        opts.env ?? 'dev',
        randomUUID(),
        iso(finished - 100),
        terminal ? iso(finished) : null,
        terminal ? 100 : null,
        outcome,
      ],
    );
  }

  async function insertHealth(
    outcome: 'healthy' | 'unhealthy' | 'unknown',
    scheduledForMs: number,
    measuredDelayMs: number,
    env: Env = 'dev',
  ): Promise<void> {
    const flags = { healthy: [true, true], unhealthy: [true, false], unknown: [true, null] }[outcome];
    await db.client.query(
      `INSERT INTO kpi_health_sample (id, environment, scheduled_for, measured_at, api_ok, database_ok, outcome, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)`,
      [randomUUID(), env, iso(scheduledForMs), iso(scheduledForMs + measuredDelayMs), flags[0], flags[1], outcome],
    );
  }

  async function insertHealthAt(
    outcome: 'healthy' | 'unhealthy',
    measuredAtMs: number,
    reason: string | null,
    env: Env = 'dev',
  ): Promise<void> {
    await db.client.query(
      `INSERT INTO kpi_health_sample (id, environment, scheduled_for, measured_at, api_ok, database_ok, outcome, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        env,
        iso(measuredAtMs - (measuredAtMs % (30 * MINUTE_MS))),
        iso(measuredAtMs),
        true,
        outcome === 'healthy',
        outcome,
        reason,
      ],
    );
  }

  async function results(env: Env = 'dev'): Promise<KpiResult[]> {
    const aggregates = await repo.loadAggregates(env, WINDOW);
    return buildTelemetryResults(aggregates, WINDOW, new Date('2026-10-10T00:05:00.000Z'));
  }

  const pick = (rs: KpiResult[], id: KpiResult['kpi_id']): KpiResult => rs.find(r => r.kpi_id === id) as KpiResult;

  it('F1: 20 duraciones 1..20 ms ⇒ p95 = 19 (percentile_disc 0.95)', async () => {
    for (let ms = 1; ms <= 20; ms += 1) {
      await insertHttp('success', { durationMs: ms, finishedAtMs: IN_WINDOW_MS + ms * 1000 });
    }

    const aggregates = await repo.loadAggregates('dev', WINDOW);
    expect(aggregates.http.p95DurationMs).toBe(19);

    const p95 = pick(await results(), 'latency_p95_ms');
    expect(p95).toMatchObject({ value: 19, quality: 'observed', sample_count: 20 });
  });

  it('F2: 1 timeout + 1 server_error sobre 10 ⇒ error 20, timeout 10; pending excluidos; 4xx no suma errores', async () => {
    for (let i = 0; i < 8; i += 1) await insertHttp('success');
    await insertHttp('timeout');
    await insertHttp('server_error');
    await insertHttp('pending');
    await insertHttp('pending');

    let rs = await results();
    expect(pick(rs, 'operations_count')).toMatchObject({ value: 10, quality: 'observed', sample_count: 10 });
    expect(pick(rs, 'error_rate')).toMatchObject({ value: 20, sample_count: 10 });
    expect(pick(rs, 'timeout_rate')).toMatchObject({ value: 10, sample_count: 10 });

    const aggregates = await repo.loadAggregates('dev', WINDOW);
    expect(aggregates.http.pendingIncomplete).toBe(2);

    await insertHttp('client_error');
    rs = await results();
    expect(pick(rs, 'operations_count').value).toBe(11);
    expect(pick(rs, 'error_rate').value).toBeCloseTo((2 / 11) * 100, 10);
    expect((await repo.loadAggregates('dev', WINDOW)).http.serverError).toBe(1);
  });

  it('ventana [start, end): incluye finished_at = start, excluye finished_at = end', async () => {
    await insertHttp('success', { finishedAtMs: WINDOW.start.getTime() });
    await insertHttp('server_error', { finishedAtMs: WINDOW.end.getTime() });
    await insertHttp('server_error', { finishedAtMs: WINDOW.start.getTime() - 1 });

    const rs = await results();
    expect(pick(rs, 'operations_count').value).toBe(1);
    expect(pick(rs, 'error_rate').value).toBe(0);
  });

  it('F3: 2 fallos (error + timeout) sobre 8 intentos ⇒ dependency_error_rate 25; pending no cuenta', async () => {
    for (let i = 0; i < 6; i += 1) await insertDependency('success');
    await insertDependency('error');
    await insertDependency('timeout');
    await insertDependency('pending');
    await insertDependency('error', { finishedAtMs: WINDOW.end.getTime() + MINUTE_MS }); // fuera de ventana

    expect(pick(await results(), 'dependency_error_rate')).toMatchObject({
      value: 25,
      quality: 'observed',
      sample_count: 8,
    });
  });

  it('F4: un éxito anterior a start se usa para last_success_age; éxitos en/después de end no', async () => {
    const before = Date.parse('2026-10-08T23:00:00.000Z');
    await insertHttp('success', { finishedAtMs: before - 5 * MINUTE_MS });
    await insertHttp('success', { finishedAtMs: before });
    await insertHttp('success', { finishedAtMs: WINDOW.end.getTime() }); // = end ⇒ excluido
    await insertHttp('server_error'); // no es éxito

    expect(pick(await results(), 'last_success_age_seconds')).toMatchObject({
      value: 90_000,
      quality: 'observed',
      sample_count: 1,
    });
  });

  it('F4: sin éxito conocido ⇒ unavailable NO_SUCCESS_KNOWN', async () => {
    await insertHttp('server_error');

    expect(pick(await results(), 'last_success_age_seconds')).toMatchObject({
      value: null,
      quality: 'unavailable',
      reason: 'NO_SUCCESS_KNOWN',
    });
  });

  it('F5: muestras insertadas fuera de orden ⇒ toma la de mayor measured_at', async () => {
    const lastBucket = Date.parse('2026-10-09T23:30:00.000Z');
    await insertHealth('unhealthy', lastBucket, 20 * 1000); // la más reciente por tiempo real, insertada primero
    await insertHealth('healthy', lastBucket - 30 * MINUTE_MS, 5 * 1000); // insertada después, más vieja

    const aggregates = await repo.loadAggregates('dev', WINDOW);
    expect(aggregates.latestHealth?.outcome).toBe('unhealthy');
    expect(aggregates.latestHealth?.measuredAt.toISOString()).toBe('2026-10-09T23:30:20.000Z');

    expect(pick(await results(), 'health_status')).toMatchObject({ value: 0, quality: 'observed', sample_count: 1 });
  });

  it('F5: última muestra > 60 min antes del corte ⇒ HEALTH_SAMPLE_STALE; unknown ⇒ HEALTH_UNKNOWN', async () => {
    await insertHealth('healthy', Date.parse('2026-10-09T22:30:00.000Z'), 0); // 90 min antes del corte
    expect(pick(await results(), 'health_status')).toMatchObject({ value: null, reason: 'HEALTH_SAMPLE_STALE' });

    await insertHealth('unknown', Date.parse('2026-10-09T23:30:00.000Z'), 1000);
    expect(pick(await results(), 'health_status')).toMatchObject({ value: null, reason: 'HEALTH_UNKNOWN' });
  });

  it('F5: muestras fuera de ventana no cuentan; sin muestras ⇒ NO_HEALTH_SAMPLE', async () => {
    await insertHealth('healthy', WINDOW.end.getTime(), 1000); // measured_at > end

    const rs = await results();
    expect(pick(rs, 'health_status')).toMatchObject({ value: null, reason: 'NO_HEALTH_SAMPLE' });
    expect(pick(rs, 'availability_rate')).toMatchObject({ value: null, reason: 'NO_VALID_HEALTH_SAMPLES' });
  });

  it('F6: 2 healthy + 1 unhealthy + 1 unknown ⇒ availability 66.666…, sample_count 3', async () => {
    const base = Date.parse('2026-10-09T21:00:00.000Z');
    await insertHealth('healthy', base, 1000);
    await insertHealth('healthy', base + 30 * MINUTE_MS, 1000);
    await insertHealth('unhealthy', base + 60 * MINUTE_MS, 1000);
    await insertHealth('unknown', base + 90 * MINUTE_MS, 1000);

    const availability = pick(await results(), 'availability_rate');
    expect(availability.quality).toBe('observed');
    expect(availability.value).toBeCloseTo(66.6666666667, 9);
    expect(availability.sample_count).toBe(3);
  });

  it('F6: sólo unknown ⇒ NO_VALID_HEALTH_SAMPLES', async () => {
    await insertHealth('unknown', Date.parse('2026-10-09T23:30:00.000Z'), 1000);

    expect(pick(await results(), 'availability_rate')).toMatchObject({
      value: null,
      quality: 'unavailable',
      reason: 'NO_VALID_HEALTH_SAMPLES',
    });
  });

  it('filtra por ambiente', async () => {
    await insertHttp('success', { env: 'dev' });
    await insertHttp('server_error', { env: 'qa' });
    await insertHttp('success', { env: 'qa', finishedAtMs: Date.parse('2026-10-09T23:59:00.000Z') });
    await insertDependency('error', { env: 'qa' });
    await insertHealth('unhealthy', Date.parse('2026-10-09T23:30:00.000Z'), 1000, 'qa');

    const dev = await results('dev');
    expect(pick(dev, 'operations_count').value).toBe(1);
    expect(pick(dev, 'error_rate').value).toBe(0);
    expect(pick(dev, 'last_success_age_seconds').value).toBe(Math.round((WINDOW.end.getTime() - IN_WINDOW_MS) / 1000));
    expect(pick(dev, 'dependency_error_rate').reason).toBe('NO_DEPENDENCY_ATTEMPTS');
    expect(pick(dev, 'health_status').reason).toBe('NO_HEALTH_SAMPLE');

    const qa = await results('qa');
    expect(pick(qa, 'operations_count').value).toBe(2);
    expect(pick(qa, 'error_rate').value).toBe(50);
    expect(pick(qa, 'last_success_age_seconds').value).toBe(60);
    expect(pick(qa, 'dependency_error_rate').value).toBe(100);
    expect(pick(qa, 'health_status').value).toBe(0);
  });

  // Fix 1 (goal-fixes): TelemetryAggregates.instrumentationDisabledSamples = muestras con measured_at en
  // [start, end), del ambiente, con reason 'INSTRUMENTATION_DISABLED'.
  it('sin muestras INSTRUMENTATION_DISABLED ⇒ instrumentationDisabledSamples 0 y operations_count 0 observed', async () => {
    await insertHealthAt('healthy', IN_WINDOW_MS, null);
    await insertHealthAt('unhealthy', IN_WINDOW_MS + 30 * MINUTE_MS, 'API_TIMEOUT');

    const aggregates = await repo.loadAggregates('dev', WINDOW);
    expect(aggregates.instrumentationDisabledSamples).toBe(0);
    expect(pick(await results(), 'operations_count')).toMatchObject({ value: 0, quality: 'observed', reason: null });
  });

  it('cuenta sólo las INSTRUMENTATION_DISABLED dentro de [start, end) y del ambiente; los 6 KPI de eventos unavailable', async () => {
    const lastBucket = Date.parse('2026-10-09T23:30:00.000Z');
    await insertHealthAt('healthy', WINDOW.start.getTime(), 'INSTRUMENTATION_DISABLED'); // = start ⇒ cuenta
    await insertHealthAt('unhealthy', IN_WINDOW_MS, 'INSTRUMENTATION_DISABLED'); // unhealthy también cuenta
    await insertHealthAt('healthy', lastBucket + 1000, null); // otra razón ⇒ no cuenta
    await insertHealthAt('healthy', WINDOW.start.getTime() - 1000, 'INSTRUMENTATION_DISABLED'); // antes de start
    await insertHealthAt('healthy', WINDOW.end.getTime(), 'INSTRUMENTATION_DISABLED'); // = end ⇒ excluida
    await insertHealthAt('healthy', IN_WINDOW_MS + 60 * MINUTE_MS, 'INSTRUMENTATION_DISABLED', 'qa'); // otro ambiente
    for (let i = 0; i < 3; i += 1) await insertHttp('success');
    await insertDependency('success');

    const dev = await repo.loadAggregates('dev', WINDOW);
    expect(dev.instrumentationDisabledSamples).toBe(2);
    expect((await repo.loadAggregates('qa', WINDOW)).instrumentationDisabledSamples).toBe(1);
    expect((await repo.loadAggregates('prod', WINDOW)).instrumentationDisabledSamples).toBe(0);

    const rs = await results();
    for (const kpiId of [
      'operations_count',
      'error_rate',
      'timeout_rate',
      'latency_p95_ms',
      'last_success_age_seconds',
      'dependency_error_rate',
    ] as const) {
      expect(pick(rs, kpiId)).toMatchObject({ value: null, quality: 'unavailable', reason: 'INSTRUMENTATION_DISABLED' });
    }
    expect(pick(rs, 'health_status')).toMatchObject({ value: 1, quality: 'observed' });
    expect(pick(rs, 'availability_rate')).toMatchObject({ quality: 'observed', sample_count: 3 });
  });
});
