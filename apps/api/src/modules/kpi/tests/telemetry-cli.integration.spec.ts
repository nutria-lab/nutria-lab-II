import { randomUUID } from 'crypto';
import { createDefaultDeps, runTelemetryCli } from '../cli/telemetry-cli';
import type { ApiProbeOutcome, DbProbeOutcome, TelemetryCliDeps } from '../cli/telemetry-cli';
import { TelemetryRepository } from '../repo/telemetry.repository';
import {
  DisposableSchema,
  applyMigrations,
  createDisposableSchema,
  describeIfKpiDb,
  kpiTestDatabaseUrl,
} from './kpi-test-db.fixture';

jest.setTimeout(120_000);

const CLOSED_PORT_URL = 'postgresql://kpi:kpi@127.0.0.1:1/kpi';
const API_BASE = 'http://127.0.0.1:9';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

describeIfKpiDb('telemetry-cli (integración Postgres)', () => {
  let db: DisposableSchema;
  let schemaUrl: string;

  beforeAll(async () => {
    db = await createDisposableSchema();
    await applyMigrations(db.client);
    const url = new URL(kpiTestDatabaseUrl() as string);
    url.searchParams.set('options', `-c search_path=${db.schema},public`);
    schemaUrl = url.toString();
  });

  afterAll(async () => {
    await db?.drop();
  });

  beforeEach(async () => {
    await db.client.query(
      'TRUNCATE kpi_http_event, kpi_dependency_event, kpi_health_sample, kpi_snapshot, kpi_publication',
    );
  });

  function deps(
    nowIso: string,
    api: ApiProbeOutcome = { kind: 'response', status: 200, body: { status: 'ok', database: 'ok' } },
    dbProbe: DbProbeOutcome = 'ok',
  ): TelemetryCliDeps & { diagnostics: Json[] } {
    const diagnostics: Json[] = [];
    return {
      ...createDefaultDeps(),
      clock: () => new Date(nowIso),
      probeApi: async () => api,
      probeDatabase: async () => dbProbe,
      writeDiagnostics: async (_dir, diag) => {
        diagnostics.push(JSON.parse(JSON.stringify(diag)));
      },
      diagnostics,
    };
  }

  const env = (databaseUrl: string) => ({ KPI_ENV: 'dev', DATABASE_URL: databaseUrl, KPI_API_BASE_URL: API_BASE, KPI_INTERNAL_TOKEN: 'integration-token' });
  const sampleArgs = ['--mode', 'sample', '--environment', 'dev', '--diagnostics-out', '/tmp/kpi-it-diag'];

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await db.client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params);
    return rows[0].n;
  }

  it('sample: reejecutar el bucket no modifica la muestra original (ON CONFLICT DO NOTHING, H1)', async () => {
    const first = deps('2026-10-12T15:40:00.000Z');
    await expect(runTelemetryCli(sampleArgs, env(schemaUrl), first)).resolves.toBe(0);

    const second = deps('2026-10-12T15:50:00.000Z', { kind: 'timeout' }, 'timeout');
    await expect(runTelemetryCli(sampleArgs, env(schemaUrl), second)).resolves.toBe(0);

    const { rows } = await db.client.query(
      `SELECT scheduled_for, measured_at, outcome, api_ok, database_ok, reason FROM kpi_health_sample`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduled_for.toISOString()).toBe('2026-10-12T15:30:00.000Z');
    expect(rows[0].measured_at.toISOString()).toBe('2026-10-12T15:40:00.000Z');
    expect(rows[0]).toMatchObject({ outcome: 'healthy', api_ok: true, database_ok: true, reason: null });
    expect(second.diagnostics[0].sample.inserted).toBe(false);
    expect(JSON.stringify(second.diagnostics[0])).toContain('SAMPLE_BUCKET_ALREADY_RECORDED');
    // también guardó los 8 previews del corte
    expect(await count(`kpi_snapshot WHERE snapshot_kind = 'preview'`)).toBe(8);
  });

  it('DB inaccesible (puerto cerrado) ⇒ exit 1 y sin fila (H2)', async () => {
    const d = deps('2026-10-12T15:40:00.000Z', undefined, 'error');

    await expect(runTelemetryCli(sampleArgs, env(CLOSED_PORT_URL), d)).resolves.toBe(1);

    expect(await count('kpi_health_sample')).toBe(0);
    expect(d.diagnostics[0].exit_code).toBe(1);
  });

  describe('purga (H6)', () => {
    const OLD = '2027-02-01T12:00:00.000Z';
    const KEEP = '2027-04-01T12:00:00.000Z'; // dentro del día en preparación (2027-04-01 local)
    // Día anterior a D: guarda el último éxito previo a start de D y no se purga (corte = 2027-03-31).
    const PREVIOUS_DAY = '2027-03-31T12:00:00.000Z';

    async function seed(environment: string, startedAt: string, reportDate: string, n = 1): Promise<void> {
      const finished = new Date(Date.parse(startedAt) + 1000).toISOString();
      await db.client.query(
        `INSERT INTO kpi_http_event (id, environment, operation, started_at, finished_at, duration_ms, http_status, outcome)
         SELECT gen_random_uuid(), $1, 'GET /x', $2, $3, 1000, 200, 'success' FROM generate_series(1, $4::int)`,
        [environment, startedAt, finished, n],
      );
      await db.client.query(
        `INSERT INTO kpi_dependency_event (id, environment, operation_id, dependency, attempt, started_at, finished_at, duration_ms, outcome)
         VALUES ($1, $2, $3, 'gemini', 1, $4, $5, 1000, 'success')`,
        [randomUUID(), environment, randomUUID(), startedAt, finished],
      );
      const bucket = new Date(Math.floor(Date.parse(startedAt) / 1_800_000) * 1_800_000).toISOString();
      await db.client.query(
        `INSERT INTO kpi_health_sample (id, environment, scheduled_for, measured_at, api_ok, database_ok, outcome, reason)
         VALUES ($1, $2, $3, $3, true, true, 'healthy', NULL)`,
        [randomUUID(), environment, bucket],
      );
      const w = { start: `${reportDate}T03:00:00.000Z`, end: new Date(Date.parse(`${reportDate}T03:00:00.000Z`) + 21 * 3_600_000).toISOString() };
      await db.client.query(
        `INSERT INTO kpi_snapshot (id, environment, report_date, window_start, window_end, snapshot_kind, kpi_id, value, quality, reason, sample_count, measured_at)
         VALUES ($1, $2, $3, $4, $5, 'final', 'operations_count', 1, 'observed', NULL, 1, $5)`,
        [randomUUID(), environment, reportDate, w.start, w.end],
      );
      await db.client.query(
        `INSERT INTO kpi_publication (run_id, environment, report_date, window_start, window_end, status, source_commit, retry_chain_id)
         VALUES ($1, $2, $3, $4, $5, 'preparing', 'abc123', $6)`,
        [randomUUID(), environment, reportDate, w.start, w.end, randomUUID()],
      );
    }

    it('borra en lotes de 1000 lo anterior al corte; publicación, otro ambiente y día en preparación intactos', async () => {
      await seed('dev', OLD, '2027-02-01', 2500);
      await seed('dev', KEEP, '2027-04-01');
      await seed('dev', PREVIOUS_DAY, '2027-03-31');
      await seed('prod', OLD, '2027-02-01');
      const purgeSpy = jest.spyOn(TelemetryRepository.prototype, 'purgeBatch');

      let code = -1;
      const d = deps('2027-04-02T15:00:00.000Z'); // 12:00 local; día en preparación 2027-04-01
      try {
        code = await runTelemetryCli(sampleArgs, env(schemaUrl), d);
        for (const call of purgeSpy.mock.calls) expect(call[3]).toBe(1000);
        for (const result of purgeSpy.mock.results) expect(await result.value).toBeLessThanOrEqual(1000);
      } finally {
        purgeSpy.mockRestore();
      }
      expect(code).toBe(0);

      // dev anterior al corte: borrado de las 4 tablas
      expect(await count(`kpi_http_event WHERE environment = 'dev' AND started_at < '2027-03-31T03:00:00Z'`)).toBe(0);
      expect(await count(`kpi_dependency_event WHERE environment = 'dev' AND started_at < '2027-03-31T03:00:00Z'`)).toBe(0);
      expect(await count(`kpi_health_sample WHERE environment = 'dev' AND scheduled_for < '2027-03-31T03:00:00Z'`)).toBe(0);
      expect(await count(`kpi_snapshot WHERE environment = 'dev' AND report_date < '2027-03-31'`)).toBe(0);
      // día en preparación / desde el corte: intacto
      expect(await count(`kpi_http_event WHERE environment = 'dev' AND started_at >= '2027-04-01T03:00:00Z'`)).toBe(1);
      expect(await count(`kpi_dependency_event WHERE environment = 'dev' AND started_at >= '2027-04-01T03:00:00Z'`)).toBe(1);
      expect(await count(`kpi_snapshot WHERE environment = 'dev' AND report_date = '2027-04-01' AND snapshot_kind = 'final'`)).toBe(1);
      // día anterior a D (2027-03-31 local): intacto
      expect(await count(`kpi_http_event WHERE environment = 'dev' AND started_at >= '2027-03-31T03:00:00Z' AND started_at < '2027-04-01T03:00:00Z'`)).toBe(1);
      expect(await count(`kpi_snapshot WHERE environment = 'dev' AND report_date = '2027-03-31'`)).toBe(1);
      // otro ambiente: intacto
      expect(await count(`kpi_http_event WHERE environment = 'prod'`)).toBe(1);
      expect(await count(`kpi_dependency_event WHERE environment = 'prod'`)).toBe(1);
      expect(await count(`kpi_health_sample WHERE environment = 'prod'`)).toBe(1);
      expect(await count(`kpi_snapshot WHERE environment = 'prod'`)).toBe(1);
      // kpi_publication nunca se toca
      expect(await count('kpi_publication')).toBe(4);

      const diag = d.diagnostics[0];
      expect(diag.purge).toMatchObject({ executed: true, cutoff: '2027-03-31' });
      expect(diag.purge.deleted.kpi_http_event).toBe(2500);
    });

    it('antes de 2027 no borra nada', async () => {
      await seed('dev', '2026-07-01T12:00:00.000Z', '2026-07-01');

      await expect(runTelemetryCli(sampleArgs, env(schemaUrl), deps('2026-12-31T15:00:00.000Z'))).resolves.toBe(0);

      expect(await count(`kpi_http_event`)).toBe(1);
      expect(await count(`kpi_dependency_event`)).toBe(1);
      expect(await count(`kpi_snapshot WHERE snapshot_kind = 'final'`)).toBe(1);
      expect(await count('kpi_publication')).toBe(1);
    });
  });
});
