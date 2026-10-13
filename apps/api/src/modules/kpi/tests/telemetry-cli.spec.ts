// NUT-85 T5 — CLI de telemetría con dependencias fake (B7, H1–H6; design D16, D22–D24). Sin red ni DB.
// API fijada (cli/telemetry-cli.ts):
//   runTelemetryCli(argv: readonly string[], env: KpiEnvSource, deps: TelemetryCliDeps): Promise<number>  // 0 | 1 | 2
//   createDefaultDeps(): TelemetryCliDeps
//   argv: --mode sample|finalize  --environment dev|qa|prod  [--date YYYY-MM-DD]  [--diagnostics-out <dir>]
//   interface TelemetryCliDeps {
//     clock(): Date;
//     probeApi(healthUrl: string, timeoutMs: number): Promise<ApiProbeOutcome>;      // `${KPI_API_BASE_URL}/health`, 5000
//     probeDatabase(databaseUrl: string, timeoutMs: number): Promise<DbProbeOutcome>; // SELECT 1, 2000
//     openStore(databaseUrl: string): TelemetryCliStore;
//     writeDiagnostics(dir: string, diagnostics: TelemetryDiagnostics): Promise<void>;
//   }
//   type ApiProbeOutcome = { kind: 'response'; status: number; body: unknown } | { kind: 'timeout' } | { kind: 'network_error' }
//   type DbProbeOutcome = 'ok' | 'timeout' | 'error'
//   interface HealthSampleInput { environment; scheduledFor: Date; measuredAt: Date; apiOk: boolean | null;
//     databaseOk: boolean | null; outcome: 'healthy' | 'unhealthy' | 'unknown'; reason: string | null }
//   interface TelemetryCliStore extends SnapshotStore, PurgePort {
//     insertHealthSample(sample: HealthSampleInput): Promise<boolean>;  // false = bucket ya registrado (ON CONFLICT DO NOTHING)
//     close(): Promise<void>;
//   }
//   Diagnóstico (JSON, snake_case): tool, mode, environment, report_date, window_start, window_end, bucket,
//     sample { outcome, inserted, reason } | null, kpis [{ kpi_id, kind, value, quality, reason, sample_count }],
//     counts { http_terminal, http_pending_incomplete, dependency_attempts, health_samples } | null,
//     purge { executed, cutoff, deleted }, error_codes: string[], exit_code, started_at, finished_at.
import { TELEMETRY_KPI_IDS } from '../calc/telemetry-formulas';
import type { PurgeCutoff } from '../cli/purge-policy';
import { PURGE_TABLES } from '../cli/purge-policy';
import { runTelemetryCli } from '../cli/telemetry-cli';
import type {
  ApiProbeOutcome,
  DbProbeOutcome,
  HealthSampleInput,
  TelemetryCliDeps,
  TelemetryCliStore,
} from '../cli/telemetry-cli';
import type { KpiEnvironment } from '../kpi-contract';
import { KpiSnapshotError, TelemetrySnapshotService } from '../snapshots/telemetry-snapshot.service';
import { FakeSnapshotStore, pgError, sampleAggregates, storedFinals } from './telemetry-fakes.fixture';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const DIAG_DIR = '/tmp/kpi-diagnostics-test';
const SECRET_DB_URL = 'postgresql://secret-user:secret-pass@db.internal.example:5432/nutria';
const SECRET_API_BASE = 'https://api.secret-host.example';
const BASE_ENV = { KPI_ENV: 'dev', DATABASE_URL: SECRET_DB_URL, KPI_API_BASE_URL: SECRET_API_BASE };
const NOW_MIDDAY = '2026-10-12T15:47:12.345Z'; // 12:47 local AR
const BUCKET_MIDDAY = '2026-10-12T15:30:00.000Z';

class FakeCliStore extends FakeSnapshotStore implements TelemetryCliStore {
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
  openStore: jest.Mock;
  writeDiagnostics: jest.Mock;
  diagnostics(): Json;
}

function harness(nowIso = NOW_MIDDAY): Harness {
  const store = new FakeCliStore((_env, w) => sampleAggregates(w.end));
  const probeApi = jest.fn(
    async (_url: string, _timeout: number): Promise<ApiProbeOutcome> => ({
      kind: 'response',
      status: 200,
      body: { status: 'ok', database: 'ok' },
    }),
  );
  const probeDatabase = jest.fn(async (_url: string, _timeout: number): Promise<DbProbeOutcome> => 'ok');
  const openStore = jest.fn((_url: string) => store);
  const writeDiagnostics = jest.fn(async (_dir: string, _diag: unknown) => undefined);
  const deps: TelemetryCliDeps = {
    clock: () => new Date(nowIso),
    probeApi,
    probeDatabase,
    openStore,
    writeDiagnostics,
  };
  return {
    deps,
    store,
    probeApi,
    probeDatabase,
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
  expect(h.store.insertHealthSample).not.toHaveBeenCalled();
  expect(h.store.isolations).toHaveLength(0);
}

describe('runTelemetryCli — argumentos y configuración (exit 2)', () => {
  it.each([
    ['sin argumentos', ['--diagnostics-out', DIAG_DIR]],
    ['modo inválido', ['--mode', 'bogus', '--environment', 'dev', '--diagnostics-out', DIAG_DIR]],
    ['sin --environment', ['--mode', 'sample', '--diagnostics-out', DIAG_DIR]],
    ['ambiente inválido', sampleArgs('staging')],
    ['flag desconocido', sampleArgs('dev', ['--force', 'yes'])],
    ['fecha mal formada', finalizeArgs(['--date', '2026-13-01'])],
    ['fecha con formato libre', finalizeArgs(['--date', '11/10/2026'])],
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

  it('finalize con corte futuro ⇒ exit 2 FUTURE_CUT', async () => {
    const h = harness('2026-10-12T15:00:00.000Z'); // 12:00 local: el corte de hoy todavía no pasó
    await expect(runTelemetryCli(finalizeArgs(['--date', '2026-10-12']), BASE_ENV, h.deps)).resolves.toBe(2);
    expectNoSideEffects(h);
    expect(h.diagnostics().error_codes).toContain('FUTURE_CUT');
  });
});

describe('runTelemetryCli — sample (H1, H2, H3)', () => {
  it('bucket floor(now/30min); API /health con 5 s y DB SELECT 1 con 2 s; una muestra healthy', async () => {
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
    ['API 503', { kind: 'response', status: 503, body: {} }, 'ok', { apiOk: false, reason: 'API_HTTP_5XX' }],
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

  it('bucket ya registrado ⇒ exit 0, inserted:false, SAMPLE_BUCKET_ALREADY_RECORDED (H1)', async () => {
    const h = harness();
    h.store.insertHealthSample.mockResolvedValue(false);

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(0);

    const diag = h.diagnostics();
    expect(diag.exit_code).toBe(0);
    expect(diag.sample.inserted).toBe(false);
    expect(JSON.stringify(diag)).toContain('SAMPLE_BUCKET_ALREADY_RECORDED');
    expect(h.store.insertHealthSample).toHaveBeenCalledTimes(1);
  });

  it('nunca crea buckets anteriores: una sola muestra, la del bucket actual (H1)', async () => {
    const h = harness('2026-10-12T15:59:59.999Z');

    await runTelemetryCli(sampleArgs(), BASE_ENV, h.deps);

    expect(h.store.insertHealthSample).toHaveBeenCalledTimes(1);
    expect(h.store.insertHealthSample.mock.calls[0][0].scheduledFor).toEqual(new Date(BUCKET_MIDDAY));
    expect(h.diagnostics().bucket).toBe(BUCKET_MIDDAY);
  });

  it('no se puede guardar la muestra ⇒ exit 1 sin observación ficticia ni previews (H2)', async () => {
    const h = harness();
    h.store.insertHealthSample.mockRejectedValue(pgError('ECONNREFUSED'));

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(1);

    expect(h.store.insertHealthSample).toHaveBeenCalledTimes(1);
    expect(h.store.isolations).toHaveLength(0);
    expect(h.store.calls.upsertPreviews).not.toHaveBeenCalled();
    expect(h.store.purgeBatch).not.toHaveBeenCalled();
    const diag = h.diagnostics();
    expect(diag.exit_code).toBe(1);
    expect(diag.sample.inserted).toBe(false);
    expect(diag.error_codes).toContain('SAMPLE_WRITE_FAILED');
  });

  it('preview con end = now cuando todavía no son las 21:00 locales (H3)', async () => {
    const h = harness('2026-10-12T15:00:00.000Z');

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(0);

    expect(h.store.calls.upsertPreviews).toHaveBeenCalledTimes(1);
    const [cut, results] = h.store.calls.upsertPreviews.mock.calls[0];
    expect(cut).toEqual({
      environment: 'dev',
      date: '2026-10-12',
      start: new Date('2026-10-12T03:00:00.000Z'),
      end: new Date('2026-10-12T15:00:00.000Z'),
    });
    expect(results.map((r: { kpi_id: string }) => r.kpi_id)).toEqual([...TELEMETRY_KPI_IDS]);
    const diag = h.diagnostics();
    expect(diag.report_date).toBe('2026-10-12');
    expect(diag.window_start).toBe('2026-10-12T03:00:00.000Z');
    expect(diag.window_end).toBe('2026-10-12T15:00:00.000Z');
  });

  it('preview con end = 21:00 de D cuando ya pasó el corte (H3)', async () => {
    const h = harness('2026-10-12T02:30:00.000Z'); // 23:30 local del 2026-10-11

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(0);

    const [cut] = h.store.calls.upsertPreviews.mock.calls[0];
    expect(cut).toEqual({
      environment: 'dev',
      date: '2026-10-11',
      start: new Date('2026-10-11T03:00:00.000Z'),
      end: new Date('2026-10-12T00:00:00.000Z'),
    });
  });

  it('sin intervalo positivo ⇒ sólo guarda la muestra y sale con 0 (H3)', async () => {
    const h = harness('2026-10-12T03:00:00.000Z'); // 00:00 local exacto

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(0);

    expect(h.store.insertHealthSample).toHaveBeenCalledTimes(1);
    expect(h.store.isolations).toHaveLength(0);
    expect(h.store.calls.upsertPreviews).not.toHaveBeenCalled();
    expect(JSON.stringify(h.diagnostics())).toContain('NO_POSITIVE_WINDOW');
  });

  it('falla del preview ⇒ exit 1 (la muestra ya quedó guardada)', async () => {
    const h = harness();
    h.store.calls.loadAggregates.mockRejectedValue(pgError('57014'));

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(1);

    expect(h.store.insertHealthSample).toHaveBeenCalledTimes(1);
    expect(h.diagnostics().exit_code).toBe(1);
  });
});

describe('runTelemetryCli — finalize (H4)', () => {
  it('no toma muestra de salud, usa REPEATABLE READ y measured_at real (no las 21:00)', async () => {
    const h = harness('2026-10-12T15:00:00.000Z');
    const coreSpy = jest.spyOn(TelemetrySnapshotService.prototype, 'finalizeCore');
    const { KPI_API_BASE_URL: _omit, ...env } = BASE_ENV; // finalize no necesita la URL de la API

    try {
      await expect(runTelemetryCli(finalizeArgs(['--date', '2026-10-11']), env, h.deps)).resolves.toBe(0);

      expect(coreSpy).toHaveBeenCalledWith({
        environment: 'dev',
        date: '2026-10-11',
        start: new Date('2026-10-11T03:00:00.000Z'),
        end: new Date('2026-10-12T00:00:00.000Z'),
      });
    } finally {
      coreSpy.mockRestore();
    }
    expect(h.probeApi).not.toHaveBeenCalled();
    expect(h.probeDatabase).not.toHaveBeenCalled();
    expect(h.store.insertHealthSample).not.toHaveBeenCalled();
    expect(h.store.purgeBatch).not.toHaveBeenCalled();
    expect(h.store.isolations).toEqual(['RepeatableRead']);
    const [, results] = h.store.calls.insertFinals.mock.calls[0];
    for (const result of results) {
      expect(result.measured_at).toBe('2026-10-12T15:00:00.000Z');
      expect(result.measured_at).not.toBe('2026-10-12T00:00:00.000Z');
    }
  });

  it('sin --date toma el último corte de las 21:00 ya ocurrido', async () => {
    const h = harness('2026-10-12T15:00:00.000Z');

    await expect(runTelemetryCli(finalizeArgs(), BASE_ENV, h.deps)).resolves.toBe(0);

    expect(h.store.calls.readFinals.mock.calls[0][0]).toMatchObject({ date: '2026-10-11' });
    expect(h.diagnostics().report_date).toBe('2026-10-11');
  });

  it('finales existentes ⇒ exit 0 sin insertar', async () => {
    const h = harness('2026-10-12T15:00:00.000Z');
    h.store.readFinalsQueue = [storedFinals('2026-10-12T00:05:00.000Z')];

    await expect(runTelemetryCli(finalizeArgs(['--date', '2026-10-11']), BASE_ENV, h.deps)).resolves.toBe(0);

    expect(h.store.calls.insertFinals).not.toHaveBeenCalled();
    expect(h.diagnostics().kpis).toHaveLength(8);
  });

  it.each([
    ['DB caída', pgError('ECONNREFUSED')],
    ['conflicto agotado', new KpiSnapshotError('KPI_FINALIZE_CONFLICT')],
  ])('%s ⇒ exit 1 (sin traducir a unavailable)', async (_name, failure) => {
    const h = harness('2026-10-12T15:00:00.000Z');
    h.store.transactionError = failure;

    await expect(runTelemetryCli(finalizeArgs(['--date', '2026-10-11']), BASE_ENV, h.deps)).resolves.toBe(1);

    const diag = h.diagnostics();
    expect(diag.exit_code).toBe(1);
    expect(diag.error_codes.length).toBeGreaterThan(0);
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
      report_date: '2026-10-12',
      window_start: '2026-10-12T03:00:00.000Z',
      window_end: NOW_MIDDAY,
      bucket: BUCKET_MIDDAY,
      sample: { outcome: 'healthy', inserted: true },
      counts: { http_terminal: 10, http_pending_incomplete: 2, dependency_attempts: 4, health_samples: 4 },
      purge: { executed: false },
      error_codes: [],
      exit_code: 0,
    });
    expect(typeof diag.tool).toBe('string');
    expect(typeof diag.started_at).toBe('string');
    expect(typeof diag.finished_at).toBe('string');
    expect(diag.kpis.map((k: Json) => k.kpi_id)).toEqual([...TELEMETRY_KPI_IDS]);
    for (const kpi of diag.kpis) {
      expect(Object.keys(kpi).sort()).toEqual(['kind', 'kpi_id', 'quality', 'reason', 'sample_count', 'value']);
      expect(kpi.kind).toBe('preview');
    }
  });

  it.each([
    ['sample con DB caída', () => sampleArgs(), (h: Harness) => h.store.insertHealthSample.mockRejectedValue(leaky())],
    [
      'finalize con DB caída',
      () => finalizeArgs(['--date', '2026-10-11']),
      (h: Harness) => {
        h.store.transactionError = leaky();
      },
    ],
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

  it('un fallo al escribir el diagnóstico no cambia el código de salida', async () => {
    const h = harness();
    h.writeDiagnostics.mockRejectedValue(new Error('disk full'));
    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(0);
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
      expect(cutoff).toMatchObject({ date: '2027-04-01' });
      expect(limit).toBe(1000);
    }
    expect(h.store.insertHealthSample.mock.invocationCallOrder[0]).toBeLessThan(
      h.store.purgeBatch.mock.invocationCallOrder[0],
    );
    const diag = h.diagnostics();
    expect(diag.purge).toMatchObject({ executed: true, cutoff: '2027-04-01' });
  });

  it('falla de purga ⇒ exit 1 con la muestra ya guardada', async () => {
    const h = harness('2027-04-02T15:00:00.000Z');
    h.store.purgeBatch.mockRejectedValue(pgError('57014'));

    await expect(runTelemetryCli(sampleArgs(), BASE_ENV, h.deps)).resolves.toBe(1);

    expect(h.store.insertHealthSample).toHaveBeenCalledTimes(1);
    expect(h.diagnostics().error_codes).toContain('PURGE_FAILED');
  });
});

function okApi(): ApiProbeOutcome {
  return { kind: 'response', status: 200, body: { status: 'ok', database: 'ok' } };
}

function leaky(): Error & { code: string } {
  return Object.assign(new Error(`LEAKY_EXCEPTION_MESSAGE ${SECRET_DB_URL}`), { code: 'ECONNREFUSED' });
}
