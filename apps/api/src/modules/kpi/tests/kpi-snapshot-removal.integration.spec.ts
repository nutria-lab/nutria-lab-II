import { randomUUID } from 'node:crypto';
import { applyMigrations, createDisposableSchema, describeIfKpiDb, findKpiMigrationDirs, type DisposableSchema } from './kpi-test-db.fixture';

jest.setTimeout(120_000);

describeIfKpiDb('Retired KPI snapshot table migration', () => {
  let db: DisposableSchema;
  let legacyMigration: string;

  beforeEach(async () => {
    db = await createDisposableSchema();
    legacyMigration = findKpiMigrationDirs()[0];
    await applyMigrations(db.client, { upTo: legacyMigration });
    await db.client.query(
      `INSERT INTO kpi_health_sample (id, environment, scheduled_for, measured_at, api_ok, database_ok, outcome)
       VALUES ($1, 'dev', '2026-10-15T12:00:00Z', '2026-10-15T12:00:00Z', true, true, 'healthy')`,
      [randomUUID()],
    );
    await db.client.query(
      `INSERT INTO kpi_publication (run_id, environment, report_date, window_start, window_end, status, source_commit, retry_chain_id)
       VALUES ($1, 'dev', '2026-10-15', '2026-10-15T03:00:00Z', '2026-10-16T00:00:00Z', 'preparing', $2, $3)`,
      [randomUUID(), 'a'.repeat(40), randomUUID()],
    );
    await db.client.query(
      `INSERT INTO kpi_snapshot (id, environment, report_date, window_start, window_end, snapshot_kind, kpi_id, value, quality, sample_count, measured_at)
       VALUES ($1, 'dev', '2026-10-15', '2026-10-15T03:00:00Z', '2026-10-16T00:00:00Z', 'final', 'operations_count', 99, 'observed', 99, '2026-10-16T00:01:00Z')`,
      [randomUUID()],
    );
  });

  afterEach(async () => { await db?.drop(); });

  it('drops only the retired table and preserves samples and publication state', async () => {
    await applyMigrations(db.client, { after: legacyMigration });
    expect((await db.client.query("SELECT to_regclass('kpi_snapshot') AS table_name")).rows[0].table_name).toBeNull();
    expect((await db.client.query('SELECT count(*)::int AS n FROM kpi_health_sample')).rows[0].n).toBe(1);
    expect((await db.client.query('SELECT count(*)::int AS n FROM kpi_publication')).rows[0].n).toBe(1);
    for (const table of ['kpi_http_event', 'kpi_dependency_event']) {
      expect((await db.client.query('SELECT to_regclass($1) AS table_name', [table])).rows[0].table_name).not.toBeNull();
    }
  });

});
