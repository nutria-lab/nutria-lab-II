import type { PurgeCutoff } from '../cli/purge-policy';
import { PURGE_TABLES } from '../cli/purge-policy';
import { probeApiHealth, runTelemetryCli } from '../cli/telemetry-cli';
import type {
  ApiProbeOutcome,
  DbProbeOutcome,
  HealthSampleInput,
  TelemetryCliDeps,
  TelemetryCliStore,
} from '../cli/telemetry-cli';
import * as http from 'http';
import type { AddressInfo } from 'node:net';
import type { KpiEnvironment } from '../kpi-contract';
import { KpiResponseError, KpiTransportError } from '../kpi-api-client';
import type { KpiSampleResponse } from '../kpi-api-client';
import { pgError } from './telemetry-fakes.fixture';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const DIAG_DIR = '/tmp/kpi-diagnostics-test';
const SECRET_DB_URL = 'postgresql://secret-user:secret-pass@db.internal.example:5432/nutria';
const SECRET_API_BASE = 'https://api.secret-host.example';
const BASE_ENV = { KPI_ENV: 'dev', DATABASE_URL: SECRET_DB_URL, KPI_API_BASE_URL: SECRET_API_BASE, KPI_INTERNAL_TOKEN: 'internal-secret' };
const NOW_MIDDAY = '2026-10-12T15:47:12.345Z'; // 12:47 local AR
const BUCKET_MIDDAY = '2026-10-12T15:30:00.000Z';

class FakeCliStore implements TelemetryCliStore {
  readonly loadAggregates = jest.fn();
  readonly insertHealthSample = jest.fn(async (_sample: HealthSampleInput) => true);
  readonly purgeBatch = jest.fn(
    async (_table: string, _env: KpiEnvironment, _cutoff: PurgeCutoff, _limit: number) => 0,
  );
  readonly close = jest.fn(async () => undefined);
}

interface Harness {
  deps: TelemetryCliDeps;
  store: FakeCliStore;
  probeApi: jest.Mock;
  probeDatabase: jest.Mock;
  apiClient: jest.Mock;
  openStore: jest.Mock;
  writeDiagnostics: jest.Mock;
  diagnostics(): Json;
}

function harness(nowIso = NOW_MIDDAY): Harness {
  const store = new FakeCliStore();
  const probeApi = jest.fn(
    async (_url: string, _timeout: number): Promise<ApiProbeOutcome> => ({
      kind: 'response',
      status: 200,
      body: { status: 'ok', database: 'ok' },
    }),
  );
  const probeDatabase = jest.fn(async (_url: string, _timeout: number): Promise<DbProbeOutcome> => 'ok');
  const apiClient = jest.fn(() => ({
    sample: jest.fn(async (_request: unknown): Promise<KpiSampleResponse> => {
      throw new KpiTransportError('KPI_API_NETWORK_ERROR');
    }),
  }));
  const openStore = jest.fn((_url: string) => store);
  const writeDiagnostics = jest.fn(async (_dir: string, _diag: unknown) => undefined);
  const deps: TelemetryCliDeps = {
    clock: () => new Date(nowIso),
    probeApi,
    probeDatabase,
    apiClient,
    openStore,
    writeDiagnostics,
  };
  return {
    deps,
    store,
    probeApi,
    probeDatabase,
    apiClient,
    openStore,
    writeDiagnostics,
    diagnostics: () => {
      expect(writeDiagnostics).toHaveBeenCalledTimes(1);
      expect(writeDiagnostics.mock.calls[0][0]).toBe(DIAG_DIR);
      return JSON.parse(JSON.stringify(writeDiagnostics.mock.calls[0][1]));
    },
  };
}

const sampleArgs = (env = 'dev', extra: string[] = []) => [
  '--mode',
  'sample',
  '--environment',
  env,
  '--diagnostics-out',
  DIAG_DIR,
  ...extra,
];
const finalizeArgs = (extra: string[] = []) => [
  '--mode',
  'finalize',
  '--environment',
  'dev',
  '--diagnostics-out',
  DIAG_DIR,
  ...extra,
];

function expectNoSideEffects(h: Harness): void {
  expect(h.openStore).not.toHaveBeenCalled();
  expect(h.probeApi).not.toHaveBeenCalled();
  expect(h.probeDatabase).not.toHaveBeenCalled();
  expect(h.apiClient).not.toHaveBeenCalled();
  expect(h.store.insertHealthSample).not.toHaveBeenCalled();
  expect(h.store.loadAggregates).not.toHaveBeenCalled();
}

describe('runTelemetryCli — argumentos y configuración (exit 2)', () => {
  it('rejects the removed finalize mode without probing or writing data', async () => {
    const h = harness();
    await expect(runTelemetryCli(finalizeArgs(), BASE_ENV, h.deps)).resolves.toBe(2);
    expectNoSideEffects(h);
    expect(h.diagnostics().error_codes).toContain('INVALID_MODE');
  });

  it.each([
    ['sin argumentos', ['--diagnostics-out', DIAG_DIR]],
    ['modo inválido', ['--mode', 'bogus', '--environment', 'dev', '--diagnostics-out', DIAG_DIR]],
    ['sin --environment', ['--mode', 'sample', '--diagnostics-out', DIAG_DIR]],
    ['ambiente inválido', sampleArgs('staging')],
    ['flag desconocido', sampleArgs('dev', ['--force', 'yes'])],
    ['removed historical date flag', sampleArgs('dev', ['--date', '2026-10-11'])],
  ])('%s ⇒ exit 2 sin escrituras y con diagnóstico', async (_name, argv) => {
    const h = harness();
    await expect(runTelemetryCli(argv, BASE_ENV, h.deps)).resolves.toBe(2);
    expectNoSideEffects(h);
    expect(h.diagnostics().exit_code).toBe(2);
  });

  it.each([
    ['faltante', undefined, 'KPI_ENV_MISSING'],
    ['vacío', '', 'KPI_ENV_MISSING'],
    ['inválido', 'staging', 'KPI_ENV_INVALID'],
    ['distinto de --environment', 'prod', 'KPI_ENV_MISMATCH'],
  ])('KPI_ENV %s ⇒ exit 2 sin escrituras (B7)', async (_name, kpiEnv, code) => {
    const h = harness();
    const env = { ...BASE_ENV, KPI_ENV: kpiEnv };
    await expect(runTelemetryCli(sampleArgs('dev'), env, h.deps)).resolves.toBe(2);
    expectNoSideEffects(h);
    const diag = h.diagnostics();
    expect(diag.exit_code).toBe(2);
    expect(diag.error_codes).toContain(code);
  });

  it('KPI_API_BASE_URL faltante en sample ⇒ exit 2', async () => {
    const h = harness();
    const { KPI_API_BASE_URL: _omit, ...env } = BASE_ENV;
    await expect(runTelemetryCli(sampleArgs(), env, h.deps)).resolves.toBe(2);
    expectNoSideEffects(h);
    expect(h.diagnostics().error_codes).toContain('KPI_API_BASE_URL_MISSING');
  });

  it('DATABASE_URL faltante ⇒ exit 2', async () => {
    const h = harness();
    const { DATABASE_URL: _omit, ...env } = BASE_ENV;
    await expect(runTelemetryCli(sampleArgs(), env, h.deps)).resolves.toBe(2);
    expectNoSideEffects(h);
    expect(h.diagnostics().error_codes).toContain('DATABASE_URL_MISSING');
  });

  it('KPI_INTERNAL_TOKEN faltante ⇒ exit 2 sin tocar fuentes', async () => {
    const h = harness();
    const { KPI_INTERNAL_TOKEN: _omit, ...env } = BASE_ENV;
    await expect(runTelemetryCli(sampleArgs(), env, h.deps)).resolves.toBe(2);
    expectNoSideEffects(h);
    expect(h.diagnostics().error_codes).toContain('KPI_INTERNAL_TOKEN_MISSING');
  });

});

describe('runTelemetryCli — sample (H1, H2, H3)', () => {
  it('stores the API health sample without opening a direct database connection', async () => {
    const h = harness();
    const sample = jest.fn(async () => ({
      sample: { outcome: 'healthy' as const, inserted: true, reason: null },
      purge: { executed: false, cutoff: null, deleted: null },
    }));
    h.apiClient.mockReturnValue({ sample });

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(0);

    expect(h.probeApi).toHaveBeenCalledTimes(1);
    expect(sample).toHaveBeenCalledWith(expect.objectContaining({
      scheduled_for: BUCKET_MIDDAY,
      measured_at: NOW_MIDDAY,
      api_ok: true,
      database_ok: true,
    }));
    expect(h.probeDatabase).not.toHaveBeenCalled();
    expect(h.openStore).not.toHaveBeenCalled();
    expect(h.diagnostics()).toMatchObject({
      sample: { inserted: true, outcome: 'healthy' },
    });
  });

  it('un error HTTP del endpoint de sample falla sin activar el fallback local', async () => {
    const h = harness();
    const sample = jest.fn(async () => { throw new KpiResponseError(503, 'KPI_API_HTTP_ERROR'); });
    h.apiClient.mockReturnValue({ sample });

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(1);

    expect(sample).toHaveBeenCalledTimes(1);
    expect(h.probeDatabase).not.toHaveBeenCalled();
    expect(h.openStore).not.toHaveBeenCalled();
    expect(h.store.insertHealthSample).not.toHaveBeenCalled();
    expect(h.diagnostics().error_codes).toContain('KPI_API_HTTP_ERROR');
  });

  it('bucket floor(now/30min); API primero, DB SELECT 1 de fallback con 2 s; una muestra healthy', async () => {
    const h = harness();

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(0);

    expect(h.probeApi).toHaveBeenCalledTimes(1);
    expect(h.probeApi).toHaveBeenCalledWith(`${SECRET_API_BASE}/health`, 5000);
    expect(h.probeDatabase).toHaveBeenCalledTimes(1);
    expect(h.probeDatabase).toHaveBeenCalledWith(SECRET_DB_URL, 2000);
    expect(h.openStore).toHaveBeenCalledWith(SECRET_DB_URL);
    expect(h.store.insertHealthSample).toHaveBeenCalledTimes(1);
    const sample = h.store.insertHealthSample.mock.calls[0][0];
    expect(sample).toMatchObject({
      environment: 'dev',
      scheduledFor: new Date(BUCKET_MIDDAY),
      apiOk: true,
      databaseOk: true,
      outcome: 'healthy',
      reason: null,
    });
    expect(sample.measuredAt.getTime()).toBeGreaterThanOrEqual(sample.scheduledFor.getTime());
    expect(h.store.close).toHaveBeenCalled();
  });

  it.each<[string, ApiProbeOutcome, DbProbeOutcome, Partial<HealthSampleInput>]>([
    ['timeout de API', { kind: 'timeout' }, 'ok', { apiOk: false, databaseOk: true, reason: 'API_TIMEOUT' }],
    ['API 503', { kind: 'response', status: 503, body: {} }, 'ok', { apiOk: false, databaseOk: false, reason: 'API_HTTP_503' }],
    ['API 500', { kind: 'response', status: 500, body: {} }, 'ok', { apiOk: false, reason: 'API_HTTP_5XX' }],
    ['API de red', { kind: 'network_error' }, 'ok', { apiOk: false, reason: 'API_NETWORK_ERROR' }],
    ['API 200 con body no ok', { kind: 'response', status: 200, body: { status: 'error' } }, 'ok', { apiOk: false }],
    ['timeout de DB', okApi(), 'timeout', { apiOk: true, databaseOk: false, reason: 'DB_TIMEOUT' }],
    ['error de DB', okApi(), 'error', { apiOk: true, databaseOk: false, reason: 'DB_ERROR' }],
  ])('%s ⇒ unhealthy con motivo (H1)', async (_name, api, db, expected) => {
    const h = harness();
    h.probeApi.mockResolvedValue(api);
    h.probeDatabase.mockResolvedValue(db);

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(0);

    expect(h.store.insertHealthSample).toHaveBeenCalledTimes(1);
    expect(h.store.insertHealthSample.mock.calls[0][0]).toMatchObject({ outcome: 'unhealthy', ...expected });
  });

  it('preserves an already recorded health bucket without reading aggregates', async () => {
    const h = harness();
    h.store.insertHealthSample.mockResolvedValue(false);

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(0);

    const diag = h.diagnostics();
    expect(diag.exit_code).toBe(0);
    expect(diag.sample.inserted).toBe(false);
    expect(JSON.stringify(diag)).toContain('SAMPLE_BUCKET_ALREADY_RECORDED');
    expect(h.store.insertHealthSample).toHaveBeenCalledTimes(1);
    expect(h.store.loadAggregates).not.toHaveBeenCalled();
  });

  it('nunca crea buckets anteriores: una sola muestra, la del bucket actual (H1)', async () => {
    const h = harness('2026-10-12T15:59:59.999Z');

    await runTelemetryCli(sampleArgs(), BASE_ENV, h.deps);

    expect(h.store.insertHealthSample).toHaveBeenCalledTimes(1);
    expect(h.store.insertHealthSample.mock.calls[0][0].scheduledFor).toEqual(new Date(BUCKET_MIDDAY));
    expect(h.diagnostics().bucket).toBe(BUCKET_MIDDAY);
  });

  it('no se puede guardar la muestra ⇒ exit 1 sin observación ficticia (H2)', async () => {
    const h = harness();
    h.store.insertHealthSample.mockRejectedValue(pgError('ECONNREFUSED'));

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(1);

    expect(h.store.insertHealthSample).toHaveBeenCalledTimes(1);
    expect(h.store.loadAggregates).not.toHaveBeenCalled();
    expect(h.store.loadAggregates).not.toHaveBeenCalled();
    expect(h.store.purgeBatch).not.toHaveBeenCalled();
    const diag = h.diagnostics();
    expect(diag.exit_code).toBe(1);
    expect(diag.sample.inserted).toBe(false);
    expect(diag.error_codes).toContain('SAMPLE_WRITE_FAILED');
  });

});

describe('runTelemetryCli — diagnóstico (H5)', () => {
  it('sample exitoso: campos de D24 con ventana, muestras, calidad y conteos', async () => {
    const h = harness();

    await runTelemetryCli(sampleArgs(), BASE_ENV, h.deps);

    const diag = h.diagnostics();
    expect(diag).toMatchObject({
      mode: 'sample',
      environment: 'dev',
      bucket: BUCKET_MIDDAY,
      sample: { outcome: 'healthy', inserted: true },
      purge: { executed: false },
      error_codes: [],
      exit_code: 0,
    });
    expect(typeof diag.tool).toBe('string');
    expect(typeof diag.started_at).toBe('string');
    expect(typeof diag.finished_at).toBe('string');
    expect(h.store.loadAggregates).not.toHaveBeenCalled();
  });

  it.each([
    ['sample con DB caída', () => sampleArgs(), (h: Harness) => h.store.insertHealthSample.mockRejectedValue(leaky())],
    [
      'openStore que lanza',
      () => sampleArgs(),
      (h: Harness) =>
        h.openStore.mockImplementation(() => {
          throw leaky();
        }),
    ],
  ])('%s ⇒ exit 1, diagnóstico escrito y sin secretos ni mensajes de excepción', async (_name, args, arrange) => {
    const h = harness('2026-10-12T15:00:00.000Z');
    arrange(h);

    await expect(runTelemetryCli(args(), BASE_ENV, h.deps)).resolves.toBe(1);

    const text = JSON.stringify(h.diagnostics());
    expect(text).not.toContain(SECRET_DB_URL);
    expect(text).not.toContain('secret-pass');
    expect(text).not.toContain('secret-host');
    expect(text).not.toContain('db.internal.example');
    expect(text).not.toContain(SECRET_API_BASE);
    expect(text).not.toContain('LEAKY_EXCEPTION_MESSAGE');
    expect(text).not.toContain(DIAG_DIR);
  });

  it('un fallo al escribir el diagnóstico convierte la corrida en error visible', async () => {
    const h = harness();
    h.writeDiagnostics.mockRejectedValue(new Error('disk full'));
    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(1);
  });
});

describe('runTelemetryCli — purga (H6)', () => {
  it('antes de 2027-01-01 no purga', async () => {
    const h = harness('2026-12-31T15:00:00.000Z');
    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(0);
    expect(h.store.purgeBatch).not.toHaveBeenCalled();
    expect(h.diagnostics().purge.executed).toBe(false);
  });

  it('desde 2027 purga sólo las 4 tablas, con el corte trimestral y después de la muestra', async () => {
    const h = harness('2027-04-02T15:00:00.000Z');

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(0);

    expect(h.store.purgeBatch).toHaveBeenCalled();
    for (const [table, env, cutoff, limit] of h.store.purgeBatch.mock.calls) {
      expect(PURGE_TABLES).toContain(table);
      expect(table).not.toBe('kpi_publication');
      expect(env).toBe('dev');
      expect(cutoff).toMatchObject({ date: '2027-03-31' }); // día anterior al D en preparación (2027-04-01)
      expect(limit).toBe(1000);
    }
    expect(h.store.insertHealthSample.mock.invocationCallOrder[0]).toBeLessThan(
      h.store.purgeBatch.mock.invocationCallOrder[0],
    );
    const diag = h.diagnostics();
    expect(diag.purge).toMatchObject({ executed: true, cutoff: '2027-03-31' });
  });

  it('falla de purga ⇒ exit 1 con la muestra ya guardada', async () => {
    const h = harness('2027-04-02T15:00:00.000Z');
    h.store.purgeBatch.mockRejectedValue(pgError('57014'));

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(1);

    expect(h.store.insertHealthSample).toHaveBeenCalledTimes(1);
    expect(h.diagnostics().error_codes).toContain('PURGE_FAILED');
  });
});

// /health con X-KPI-Instrumentation: disabled ⇒ la muestra se guarda igual (misma salud)
// con reason 'INSTRUMENTATION_DISABLED' (también si es unhealthy). Header ausente o enabled ⇒ reason como antes.
describe('runTelemetryCli — sample con instrumentación apagada (X-KPI-Instrumentation)', () => {
  const okBody = { status: 'ok', database: 'ok' };

  it.each<[string, ApiProbeOutcome, DbProbeOutcome, Partial<HealthSampleInput>]>([
    [
      'API y DB ok',
      { kind: 'response', status: 200, body: okBody, instrumentation: 'disabled' },
      'ok',
      { outcome: 'healthy', apiOk: true, databaseOk: true },
    ],
    [
      'API 503',
      { kind: 'response', status: 503, body: { status: 'error', database: 'error' }, instrumentation: 'disabled' },
      'ok',
      { outcome: 'unhealthy', apiOk: false, databaseOk: false },
    ],
    [
      'API 200 con body no ok',
      { kind: 'response', status: 200, body: { status: 'error' }, instrumentation: 'disabled' },
      'ok',
      { outcome: 'unhealthy', apiOk: false, databaseOk: true },
    ],
    [
      'DB con error',
      { kind: 'response', status: 200, body: okBody, instrumentation: 'disabled' },
      'error',
      { outcome: 'unhealthy', apiOk: true, databaseOk: false },
    ],
    [
      'DB con timeout',
      { kind: 'response', status: 200, body: okBody, instrumentation: 'disabled' },
      'timeout',
      { outcome: 'unhealthy', apiOk: true, databaseOk: false },
    ],
  ])('header disabled con %s ⇒ muestra guardada con reason INSTRUMENTATION_DISABLED', async (_name, api, db, expected) => {
    const h = harness();
    h.probeApi.mockResolvedValue(api);
    h.probeDatabase.mockResolvedValue(db);

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(0);

    expect(h.store.insertHealthSample).toHaveBeenCalledTimes(1);
    expect(h.store.insertHealthSample.mock.calls[0][0]).toMatchObject({
      environment: 'dev',
      scheduledFor: new Date(BUCKET_MIDDAY),
      ...expected,
      reason: 'INSTRUMENTATION_DISABLED',
    });
    const diag = h.diagnostics();
    expect(diag.sample).toMatchObject({
      outcome: expected.outcome,
      inserted: true,
      reason: 'INSTRUMENTATION_DISABLED',
      result: 'SAMPLE_RECORDED',
    });
  });

  it.each<[string, ApiProbeOutcome, DbProbeOutcome, Partial<HealthSampleInput>]>([
    ['header enabled y todo ok', { kind: 'response', status: 200, body: okBody, instrumentation: 'enabled' }, 'ok', { outcome: 'healthy', reason: null }],
    ['header ausente (null) y todo ok', { kind: 'response', status: 200, body: okBody, instrumentation: null }, 'ok', { outcome: 'healthy', reason: null }],
    ['header ausente (sin campo) y todo ok', okApi(), 'ok', { outcome: 'healthy', reason: null }],
    [
      'header enabled y DB timeout',
      { kind: 'response', status: 200, body: okBody, instrumentation: 'enabled' },
      'timeout',
      { outcome: 'unhealthy', databaseOk: false, reason: 'DB_TIMEOUT' },
    ],
    [
      'header ausente y API 503',
      { kind: 'response', status: 503, body: {}, instrumentation: null },
      'ok',
      { outcome: 'unhealthy', apiOk: false, reason: 'API_HTTP_503' },
    ],
  ])('%s ⇒ reason como antes', async (_name, api, db, expected) => {
    const h = harness();
    h.probeApi.mockResolvedValue(api);
    h.probeDatabase.mockResolvedValue(db);

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(0);

    expect(h.store.insertHealthSample.mock.calls[0][0]).toMatchObject(expected);
  });
});

describe('probeApiHealth — expone X-KPI-Instrumentation', () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function serve(status: number, header: string | null): Promise<string> {
    server = http.createServer((_req, res) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (header !== null) headers['X-KPI-Instrumentation'] = header;
      res.writeHead(status, headers);
      res.end(JSON.stringify(status === 200 ? { status: 'ok', database: 'ok' } : { status: 'error', database: 'error' }));
    });
    await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/health`;
  }

  it.each<[number, string | null, 'enabled' | 'disabled' | null]>([
    [200, 'disabled', 'disabled'],
    [200, 'enabled', 'enabled'],
    [503, 'disabled', 'disabled'],
    [200, null, null],
    [200, 'garbage', null],
  ])('status %p con header %p ⇒ instrumentation %p', async (status, header, expected) => {
    const url = await serve(status, header);

    const outcome = await probeApiHealth(url, 2000);

    expect(outcome).toMatchObject({ kind: 'response', status });
    expect(outcome.kind === 'response' ? (outcome.instrumentation ?? null) : 'not-a-response').toBe(expected);
  });
});

function okApi(): ApiProbeOutcome {
  return { kind: 'response', status: 200, body: { status: 'ok', database: 'ok' } };
}

function leaky(): Error & { code: string } {
  return Object.assign(new Error(`LEAKY_EXCEPTION_MESSAGE ${SECRET_DB_URL}`), { code: 'ECONNREFUSED' });
}
