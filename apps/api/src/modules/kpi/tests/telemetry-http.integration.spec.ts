import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { DIAGNOSTICS_FILE_NAME, type TelemetryDiagnostics } from '../cli/telemetry-cli';
import { resolveFinalizeDate, windowForDate } from '../window/kpi-window';
import { KpiApiClient } from '../kpi-api-client';
import { applyMigrations, createDisposableSchema, describeIfKpiDb, kpiTestDatabaseUrl, type DisposableSchema } from './kpi-test-db.fixture';

const execute = promisify(execFile);
jest.setTimeout(120_000);

describeIfKpiDb('Telemetry CLI -> full Nest application -> local PostgreSQL', () => {
  let app: INestApplication;
  let db: DisposableSchema;
  let baseUrl: string;
  let diagnosticsDir: string;
  let savedEnv: NodeJS.ProcessEnv;
  let reportDate: string;

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
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    diagnosticsDir = await mkdtemp(path.join(tmpdir(), 'nutria-telemetry-http-'));
    reportDate = resolveFinalizeDate(new Date()).date;
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
    if (diagnosticsDir) await rm(diagnosticsDir, { recursive: true, force: true });
    if (savedEnv) {
      for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
      Object.assign(process.env, savedEnv);
    }
  });

  beforeEach(async () => {
    await db.client.query('TRUNCATE kpi_http_event, kpi_dependency_event, kpi_health_sample, kpi_publication');
  });

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

  it('collects all ten KPIs from current database rows without a snapshot table', async () => {
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
    expect(first).toHaveLength(10);
    expect(first.find(result => result.kpi_id === 'operations_count')?.value).toBe(1);
    expect(first.find(result => result.kpi_id === 'manual_recipes_count')).toMatchObject({ value: 0, quality: 'observed' });

    await insertEvent();
    const second = await client.collect({ ...context, run_id: randomUUID() });
    expect(second.find(result => result.kpi_id === 'operations_count')?.value).toBe(2);

  });
});
