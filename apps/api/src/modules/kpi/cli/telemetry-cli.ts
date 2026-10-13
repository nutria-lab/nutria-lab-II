// NUT-85 — CLI de telemetría (design D22–D24, §6.4–6.8). Toda la lógica vive acá (typecheckeada con src);
// el entrypoint de scripts/kpi sólo llama a runTelemetryCli. No levanta Nest, no carga .env, no usa el alias '@/':
// toda la cadena de imports es relativa para que tsx la resuelva sin `paths`.
// Códigos de salida (D23): 0 éxito (incluye bucket ya registrado), 1 falla de telemetría, 2 uso/configuración.
// Diagnóstico (D24): siempre se intenta escribir (finally); nunca URLs, credenciales, rutas ni mensajes de excepción.
import * as fs from 'fs';
import * as path from 'path';
import type { TelemetryAggregates } from '../calc/telemetry-formulas';
import { resolveKpiConfig } from '../config/kpi-config';
import type { KpiEnvSource } from '../config/kpi-config';
import { createReportingStore } from '../db/kpi-reporting-store';
import type { TelemetryCliStore } from '../db/kpi-reporting-store';
import { sqlStateOf } from '../events/kpi-event-writer';
import { PgDbHealthProbe } from '../health/db-health-probe';
import type { KpiEnvironment, KpiResult } from '../kpi-contract';
import type { HealthSampleInput } from '../repo/telemetry.repository';
import { KpiSnapshotError, TelemetrySnapshotService } from '../snapshots/telemetry-snapshot.service';
import type { SnapshotCut, SnapshotRun } from '../snapshots/telemetry-snapshot.service';
import { KpiWindowError, resolveFinalizeDate, resolvePreviewWindow, scheduledBucket } from '../window/kpi-window';
import type { KpiWindow, PreviewWindow } from '../window/kpi-window';
import { computePurgeCutoff, runPurge } from './purge-policy';
import type { PurgeTable } from './purge-policy';

export type { HealthSampleInput } from '../repo/telemetry.repository';
export type { TelemetryCliStore } from '../db/kpi-reporting-store';

export const API_PROBE_TIMEOUT_MS = 5000;
export const DB_PROBE_TIMEOUT_MS = 2000;
export const DIAGNOSTICS_FILE_NAME = 'kpi-telemetry-diagnostics.json';
const TOOL_NAME = 'nutria-kpi-telemetry';

export type CliMode = 'sample' | 'finalize';
export type ApiProbeOutcome = { kind: 'response'; status: number; body: unknown } | { kind: 'timeout' } | { kind: 'network_error' };
export type DbProbeOutcome = 'ok' | 'timeout' | 'error';

export interface TelemetryCliDeps {
  clock(): Date;
  probeApi(healthUrl: string, timeoutMs: number): Promise<ApiProbeOutcome>;
  probeDatabase(databaseUrl: string, timeoutMs: number): Promise<DbProbeOutcome>;
  openStore(databaseUrl: string): TelemetryCliStore;
  writeDiagnostics(dir: string, diagnostics: TelemetryDiagnostics): Promise<void>;
}

export interface TelemetryDiagnostics {
  tool: string;
  mode: CliMode | null;
  environment: KpiEnvironment | null;
  report_date: string | null;
  window_start: string | null;
  window_end: string | null;
  bucket: string | null;
  sample: { outcome: HealthSampleInput['outcome']; inserted: boolean; reason: string | null; result: string } | null;
  preview: { executed: boolean; skip_reason: string | null } | null;
  reused: boolean | null;
  kpis: { kpi_id: string; kind: 'preview' | 'final'; value: number | null; quality: string; reason: string | null; sample_count: number }[];
  counts: { http_terminal: number; http_pending_incomplete: number; dependency_attempts: number; health_samples: number } | null;
  purge: { executed: boolean; cutoff: string | null; deleted: Record<PurgeTable, number> | null };
  error_codes: string[];
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
}

interface CliArgs {
  mode: CliMode;
  environment: KpiEnvironment;
  date: string | undefined;
}

/** Error de uso/configuración (exit 2). Sólo lleva un código técnico. */
class CliUsageError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

const KNOWN_FLAGS = ['--mode', '--environment', '--date', '--diagnostics-out'] as const;
const MODES: readonly string[] = ['sample', 'finalize'];
const ENVIRONMENTS: readonly string[] = ['dev', 'qa', 'prod'];

/** `--flag valor`; flags desconocidos, repetidos o sin valor se acumulan como error. */
function readFlags(argv: readonly string[]): { values: Map<string, string>; invalid: boolean } {
  const values = new Map<string, string>();
  let invalid = false;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!(KNOWN_FLAGS as readonly string[]).includes(flag) || value === undefined || value.startsWith('--')) {
      invalid = true;
      if (value !== undefined && value.startsWith('--')) i -= 1;
      continue;
    }
    if (values.has(flag)) invalid = true;
    values.set(flag, value);
  }
  return { values, invalid };
}

function parseArgs(values: Map<string, string>, invalid: boolean): CliArgs {
  if (invalid) throw new CliUsageError('INVALID_ARGUMENTS');
  const mode = values.get('--mode');
  if (mode === undefined || !MODES.includes(mode)) throw new CliUsageError('INVALID_MODE');
  const environment = values.get('--environment');
  if (environment === undefined || !ENVIRONMENTS.includes(environment)) throw new CliUsageError('INVALID_ENVIRONMENT');
  return { mode: mode as CliMode, environment: environment as KpiEnvironment, date: values.get('--date') };
}

function errorCodeOf(error: unknown, fallback: string): string {
  if (error instanceof KpiSnapshotError) return error.code;
  return fallback;
}

function apiFailureReason(outcome: ApiProbeOutcome): string | null {
  if (outcome.kind === 'timeout') return 'API_TIMEOUT';
  if (outcome.kind === 'network_error') return 'API_NETWORK_ERROR';
  if (outcome.status >= 500) return 'API_HTTP_5XX';
  const body = outcome.body as { status?: unknown } | null;
  if (outcome.status !== 200 || body === null || typeof body !== 'object' || body.status !== 'ok') {
    return 'API_HTTP_NON_OK';
  }
  return null;
}

function dbFailureReason(outcome: DbProbeOutcome): string | null {
  if (outcome === 'timeout') return 'DB_TIMEOUT';
  if (outcome === 'error') return 'DB_ERROR';
  return null;
}

function countsOf(a: TelemetryAggregates): NonNullable<TelemetryDiagnostics['counts']> {
  const { http, dependency, health } = a;
  return {
    http_terminal: http.success + http.clientError + http.serverError + http.networkError + http.timeout + http.other,
    http_pending_incomplete: http.pendingIncomplete,
    dependency_attempts: dependency.success + dependency.error + dependency.timeout,
    health_samples: health.healthy + health.unhealthy + health.unknown,
  };
}

function kpisOf(results: readonly KpiResult[], kind: 'preview' | 'final'): TelemetryDiagnostics['kpis'] {
  return results.map(r => ({
    kpi_id: r.kpi_id,
    kind,
    value: r.value,
    quality: r.quality,
    reason: r.reason,
    sample_count: r.sample_count,
  }));
}

function recordRun(diag: TelemetryDiagnostics, run: SnapshotRun, kind: 'preview' | 'final'): void {
  diag.kpis = kpisOf(run.results, kind);
  diag.counts = run.aggregates ? countsOf(run.aggregates) : null;
}

interface ResolvedRun {
  args: CliArgs;
  databaseUrl: string;
  apiBaseUrl: string;
  now: Date;
  /** Corte de la corrida: ventana del preview (end = min(now, 21:00 D)) o canónica del finalize. */
  cut: SnapshotCut;
  previewSkipReason: string | null;
}

interface RunContext extends ResolvedRun {
  deps: TelemetryCliDeps;
  diag: TelemetryDiagnostics;
}

/** Valida entorno y ventana antes de cualquier efecto (B7, D23). */
function resolveRun(args: CliArgs, env: KpiEnvSource, now: Date): ResolvedRun {
  const config = resolveKpiConfig(env);
  if (config.disabledReason === 'KPI_ENV_MISSING' || config.disabledReason === 'KPI_ENV_INVALID') {
    throw new CliUsageError(config.disabledReason);
  }
  if (config.environment !== args.environment) throw new CliUsageError('KPI_ENV_MISMATCH');
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new CliUsageError('DATABASE_URL_MISSING');
  const apiBaseUrl = env.KPI_API_BASE_URL;
  if (args.mode === 'sample' && !apiBaseUrl) throw new CliUsageError('KPI_API_BASE_URL_MISSING');

  let window: KpiWindow;
  let previewSkipReason: PreviewWindow['skipReason'] = null;
  try {
    if (args.mode === 'sample') {
      const preview = resolvePreviewWindow(now, args.date);
      previewSkipReason = preview.skipReason;
      window = preview;
    } else {
      window = resolveFinalizeDate(now, args.date);
    }
  } catch (error) {
    if (error instanceof KpiWindowError) throw new CliUsageError(error.code);
    throw error;
  }
  // Un día ya purgado no se recalcula (D29): sus eventos ya no existen.
  const purgeCutoff = args.mode === 'finalize' ? computePurgeCutoff(now) : null;
  if (purgeCutoff !== null && window.date < purgeCutoff.date) throw new CliUsageError('PURGED_WINDOW');
  return {
    args,
    databaseUrl,
    apiBaseUrl: apiBaseUrl ?? '',
    now,
    cut: { environment: args.environment, date: window.date, start: window.start, end: window.end },
    previewSkipReason,
  };
}

async function runSample(ctx: RunContext, store: () => TelemetryCliStore): Promise<number> {
  const { args, deps, diag, now } = ctx;
  const bucket = scheduledBucket(now);
  diag.bucket = bucket.toISOString();

  const healthUrl = `${ctx.apiBaseUrl.replace(/\/+$/, '')}/health`;
  const [api, db] = await Promise.all([
    deps.probeApi(healthUrl, API_PROBE_TIMEOUT_MS),
    deps.probeDatabase(ctx.databaseUrl, DB_PROBE_TIMEOUT_MS),
  ]);
  const measuredAt = deps.clock();
  const apiReason = apiFailureReason(api);
  const dbReason = dbFailureReason(db);
  const sample: HealthSampleInput = {
    environment: args.environment,
    scheduledFor: bucket,
    measuredAt,
    apiOk: apiReason === null,
    databaseOk: dbReason === null,
    outcome: apiReason === null && dbReason === null ? 'healthy' : 'unhealthy',
    reason: apiReason ?? dbReason,
  };
  diag.sample = { outcome: sample.outcome, inserted: false, reason: sample.reason, result: 'SAMPLE_WRITE_FAILED' };

  try {
    const inserted = await store().insertHealthSample(sample);
    diag.sample.inserted = inserted;
    diag.sample.result = inserted ? 'SAMPLE_RECORDED' : 'SAMPLE_BUCKET_ALREADY_RECORDED';
  } catch {
    diag.error_codes.push('SAMPLE_WRITE_FAILED');
    return EXIT_FAILURE;
  }
  // Re-ejecución del mismo bucket sin --date: la corrida original ya hizo preview y purga (D25).
  // Con --date explícito se recalcula igual el preview de ese día.
  if (!diag.sample.inserted && args.date === undefined) {
    diag.preview = { executed: false, skip_reason: 'SAMPLE_BUCKET_ALREADY_RECORDED' };
    return EXIT_OK;
  }

  if (ctx.previewSkipReason !== null) {
    diag.preview = { executed: false, skip_reason: ctx.previewSkipReason };
  } else {
    try {
      const run = await new TelemetrySnapshotService(store(), deps.clock).preview(ctx.cut);
      diag.preview = { executed: true, skip_reason: null };
      recordRun(diag, run, 'preview');
    } catch (error) {
      diag.error_codes.push(errorCodeOf(error, 'PREVIEW_FAILED'));
      return EXIT_FAILURE;
    }
  }

  const cutoff = computePurgeCutoff(now);
  if (cutoff === null) return EXIT_OK;
  diag.purge = { executed: true, cutoff: cutoff.date, deleted: null };
  try {
    const result = await runPurge(store(), args.environment, cutoff);
    diag.purge.deleted = result.deleted;
  } catch {
    diag.error_codes.push('PURGE_FAILED');
    return EXIT_FAILURE;
  }
  return EXIT_OK;
}

async function runFinalize(ctx: RunContext, store: () => TelemetryCliStore): Promise<number> {
  try {
    const run = await new TelemetrySnapshotService(store(), ctx.deps.clock).finalizeCore(ctx.cut);
    ctx.diag.reused = run.reused;
    recordRun(ctx.diag, run, 'final');
    return EXIT_OK;
  } catch (error) {
    ctx.diag.error_codes.push(errorCodeOf(error, 'FINALIZE_FAILED'));
    return EXIT_FAILURE;
  }
}

export async function runTelemetryCli(
  argv: readonly string[],
  env: KpiEnvSource,
  deps: TelemetryCliDeps,
): Promise<number> {
  const startedAt = deps.clock();
  const diag: TelemetryDiagnostics = {
    tool: TOOL_NAME,
    mode: null,
    environment: null,
    report_date: null,
    window_start: null,
    window_end: null,
    bucket: null,
    sample: null,
    preview: null,
    reused: null,
    kpis: [],
    counts: null,
    purge: { executed: false, cutoff: null, deleted: null },
    error_codes: [],
    exit_code: null,
    started_at: startedAt.toISOString(),
    finished_at: null,
  };
  const { values, invalid } = readFlags(argv);
  const diagnosticsDir = values.get('--diagnostics-out');
  let opened: TelemetryCliStore | null = null;
  let exitCode: number = EXIT_FAILURE;

  try {
    const args = parseArgs(values, invalid);
    diag.mode = args.mode;
    diag.environment = args.environment;
    const ctx: RunContext = { ...resolveRun(args, env, startedAt), deps, diag };
    diag.report_date = ctx.cut.date;
    diag.window_start = ctx.cut.start.toISOString();
    diag.window_end = ctx.cut.end.toISOString();
    const store = (): TelemetryCliStore => {
      opened ??= deps.openStore(ctx.databaseUrl);
      return opened;
    };
    exitCode = args.mode === 'sample' ? await runSample(ctx, store) : await runFinalize(ctx, store);
  } catch (error) {
    if (error instanceof CliUsageError) {
      diag.error_codes.push(error.code);
      exitCode = EXIT_USAGE;
    } else {
      diag.error_codes.push('UNEXPECTED_ERROR');
      exitCode = EXIT_FAILURE;
    }
  } finally {
    const store = opened as TelemetryCliStore | null;
    if (store !== null) await store.close().catch(() => undefined);
    diag.exit_code = exitCode;
    diag.finished_at = deps.clock().toISOString();
    if (diagnosticsDir !== undefined) {
      try {
        await deps.writeDiagnostics(diagnosticsDir, diag);
      } catch {
        // Best effort (D24): un fallo al escribir el diagnóstico no cambia el código de salida.
      }
    }
  }
  return exitCode;
}

// ---------------------------------------------------------------------------
// Dependencias reales
// ---------------------------------------------------------------------------

/** GET /health con timeout duro (abort) que cubre también la lectura del body. */
export async function probeApiHealth(healthUrl: string, timeoutMs: number): Promise<ApiProbeOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(healthUrl, { signal: controller.signal, headers: { accept: 'application/json' } });
    const body: unknown = await response.json().catch(() => null);
    if (timedOut) return { kind: 'timeout' };
    return { kind: 'response', status: response.status, body };
  } catch {
    return timedOut ? { kind: 'timeout' } : { kind: 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

function isTimeoutError(error: unknown): boolean {
  if (sqlStateOf(error) === '57014') return true;
  return error instanceof Error && /timeout|timed out/i.test(error.message);
}

/** SELECT 1 en una conexión efímera con deadline; nunca rechaza. */
export async function probeDatabaseHealth(databaseUrl: string, timeoutMs: number): Promise<DbProbeOutcome> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<DbProbeOutcome>(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const ping = new PgDbHealthProbe(databaseUrl, timeoutMs).ping().then(
    (): DbProbeOutcome => 'ok',
    (error: unknown): DbProbeOutcome => (isTimeoutError(error) ? 'timeout' : 'error'),
  );
  try {
    return await Promise.race([ping, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function writeDiagnosticsFile(dir: string, diagnostics: TelemetryDiagnostics): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, DIAGNOSTICS_FILE_NAME), `${JSON.stringify(diagnostics, null, 2)}\n`, 'utf-8');
}

export function createDefaultDeps(): TelemetryCliDeps {
  return {
    clock: () => new Date(),
    probeApi: probeApiHealth,
    probeDatabase: probeDatabaseHealth,
    openStore: createReportingStore,
    writeDiagnostics: writeDiagnosticsFile,
  };
}
