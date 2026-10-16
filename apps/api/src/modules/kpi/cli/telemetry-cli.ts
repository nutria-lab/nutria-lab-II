// Códigos de salida: 0 éxito (también bucket ya registrado), 1 falla de telemetría, 2 uso/configuración.
// Imports relativos en toda la cadena del CLI: tsx no resuelve los paths del tsconfig.
// El diagnóstico nunca incluye URLs, credenciales ni mensajes de excepción.
import * as fs from 'fs';
import * as path from 'path';
import { INSTRUMENTATION_DISABLED } from '../calc/telemetry-formulas';
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
import { KpiApiClient, KpiResponseError, KpiTransportError, KPI_API_REQUEST_TIMEOUT_MS } from '../kpi-api-client';
import type { KpiSampleRequest, KpiSampleResponse } from '../kpi-api-client';

export type { HealthSampleInput } from '../repo/telemetry.repository';
export type { TelemetryCliStore } from '../db/kpi-reporting-store';

export const API_PROBE_TIMEOUT_MS = 5000;
export const DB_PROBE_TIMEOUT_MS = 2000;
export const KPI_ENDPOINT_TIMEOUT_MS = KPI_API_REQUEST_TIMEOUT_MS;
export const DIAGNOSTICS_FILE_NAME = 'kpi-telemetry-diagnostics.json';
const TOOL_NAME = 'nutria-kpi-telemetry';

export type CliMode = 'sample' | 'finalize';
// Header de /health; ausente o desconocido (backend viejo) ⇒ null.
export type ApiProbeOutcome =
  | { kind: 'response'; status: number; body: unknown; instrumentation?: 'enabled' | 'disabled' | null }
  | { kind: 'timeout' }
  | { kind: 'network_error' };
export type DbProbeOutcome = 'ok' | 'timeout' | 'error';

export interface TelemetryCliDeps {
  clock(): Date;
  probeApi(healthUrl: string, timeoutMs: number): Promise<ApiProbeOutcome>;
  probeDatabase(databaseUrl: string, timeoutMs: number): Promise<DbProbeOutcome>;
  apiClient(baseUrl: string, token: string): Pick<KpiApiClient, 'sample' | 'finalize'>;
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
  failure: {
    stage: string;
    error_code: string;
    http_status: number | null;
    remote_error_code: string | null;
  } | null;
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
}

interface CliArgs {
  mode: CliMode;
  environment: KpiEnvironment;
  date: string | undefined;
}

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
  if (error instanceof KpiTransportError || error instanceof KpiResponseError) return error.code;
  return fallback;
}

function recordFailure(
  diag: TelemetryDiagnostics,
  stage: string,
  errorCode: string,
  error?: unknown,
): void {
  diag.error_codes.push(errorCode);
  if (diag.failure === null) {
    diag.failure = {
      stage,
      error_code: errorCode,
      http_status: error instanceof KpiResponseError ? error.status : null,
      remote_error_code: error instanceof KpiResponseError ? error.remoteCode : null,
    };
  }
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

function instrumentationDisabled(outcome: ApiProbeOutcome): boolean {
  return outcome.kind === 'response' && outcome.instrumentation === 'disabled';
}

function instrumentationOf(value: string | null): 'enabled' | 'disabled' | null {
  return value === 'enabled' || value === 'disabled' ? value : null;
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
  internalToken: string;
  now: Date;
  cut: SnapshotCut;
  previewSkipReason: string | null;
}

interface RunContext extends ResolvedRun {
  deps: TelemetryCliDeps;
  diag: TelemetryDiagnostics;
}

function resolveRun(args: CliArgs, env: KpiEnvSource, now: Date): ResolvedRun {
  const config = resolveKpiConfig(env);
  if (config.disabledReason === 'KPI_ENV_MISSING' || config.disabledReason === 'KPI_ENV_INVALID') {
    throw new CliUsageError(config.disabledReason);
  }
  if (config.environment !== args.environment) throw new CliUsageError('KPI_ENV_MISMATCH');
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new CliUsageError('DATABASE_URL_MISSING');
  const apiBaseUrl = env.KPI_API_BASE_URL;
  if (!apiBaseUrl) throw new CliUsageError('KPI_API_BASE_URL_MISSING');
  const internalToken = env.KPI_INTERNAL_TOKEN;
  if (!internalToken) throw new CliUsageError('KPI_INTERNAL_TOKEN_MISSING');

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
  // Un día ya purgado no se recalcula: sus eventos ya no existen.
  const purgeCutoff = args.mode === 'finalize' ? computePurgeCutoff(now) : null;
  if (purgeCutoff !== null && window.date < purgeCutoff.date) throw new CliUsageError('PURGED_WINDOW');
  return {
    args,
    databaseUrl,
    apiBaseUrl: apiBaseUrl ?? '',
    internalToken,
    now,
    cut: { environment: args.environment, date: window.date, start: window.start, end: window.end },
    previewSkipReason,
  };
}

function sampleRequest(
  api: ApiProbeOutcome,
  measuredAt: Date,
  bucket: Date,
  previewDate?: string,
): KpiSampleRequest {
  const request: KpiSampleRequest = {
    scheduled_for: bucket.toISOString(),
    measured_at: measuredAt.toISOString(),
    api_ok: false,
    database_ok: null,
    reason: null,
  };
  if (api.kind === 'timeout' || api.kind === 'network_error') {
    request.reason = apiFailureReason(api);
  } else if (api.status === 200) {
    const body = api.body as { status?: unknown; database?: unknown } | null;
    request.api_ok = body?.status === 'ok';
    request.database_ok = body?.database === 'ok' ? true : body?.database === 'error' ? false : null;
    request.reason = request.api_ok && request.database_ok === true ? null : 'API_HTTP_NON_OK';
  } else if (api.status === 503) {
    request.database_ok = false;
    request.reason = 'API_HTTP_503';
  } else {
    request.reason = apiFailureReason(api) ?? 'API_HTTP_NON_OK';
  }
  if (instrumentationDisabled(api)) request.reason = INSTRUMENTATION_DISABLED;
  if (previewDate !== undefined) request.preview_date = previewDate;
  return request;
}

function recordApiSample(diag: TelemetryDiagnostics, result: KpiSampleResponse): void {
  diag.sample = {
    outcome: result.sample.outcome,
    inserted: result.sample.inserted,
    reason: result.sample.reason,
    result: result.sample.inserted ? 'SAMPLE_RECORDED' : 'SAMPLE_BUCKET_ALREADY_RECORDED',
  };
  diag.preview = { executed: result.preview.executed, skip_reason: result.preview.skip_reason };
  if (result.preview.executed) diag.kpis = kpisOf(result.preview.results, 'preview');
  diag.counts = result.counts;
  diag.purge = result.purge;
}

async function runDirectSample(
  ctx: RunContext,
  request: KpiSampleRequest,
  apiFailure: string | null,
  store: () => TelemetryCliStore,
): Promise<number> {
  let db: DbProbeOutcome;
  try {
    db = await ctx.deps.probeDatabase(ctx.databaseUrl, DB_PROBE_TIMEOUT_MS);
  } catch (error) {
    recordFailure(ctx.diag, 'database_probe', errorCodeOf(error, 'DB_PROBE_FAILED'), error);
    return EXIT_FAILURE;
  }
  const dbReason = dbFailureReason(db);
  const disabled = request.reason === INSTRUMENTATION_DISABLED;
  const sample: HealthSampleInput = {
    environment: ctx.args.environment,
    scheduledFor: new Date(request.scheduled_for),
    measuredAt: new Date(request.measured_at),
    apiOk: request.api_ok,
    databaseOk: db === 'ok' ? (request.database_ok ?? true) : false,
    outcome: request.api_ok === false || db !== 'ok' || request.database_ok === false
      ? 'unhealthy'
      : request.api_ok === null || request.database_ok === null
        ? 'unknown'
        : 'healthy',
    reason: disabled ? INSTRUMENTATION_DISABLED : (request.reason ?? apiFailure ?? dbReason),
  };
  ctx.diag.sample = { outcome: sample.outcome, inserted: false, reason: sample.reason, result: 'SAMPLE_WRITE_FAILED' };
  try {
    const inserted = await store().insertHealthSample(sample);
    ctx.diag.sample.inserted = inserted;
    ctx.diag.sample.result = inserted ? 'SAMPLE_RECORDED' : 'SAMPLE_BUCKET_ALREADY_RECORDED';
  } catch (error) {
    recordFailure(ctx.diag, 'local_sample_write', 'SAMPLE_WRITE_FAILED', error);
    return EXIT_FAILURE;
  }
  if (ctx.previewSkipReason !== null) {
    ctx.diag.preview = { executed: false, skip_reason: ctx.previewSkipReason };
    return EXIT_OK;
  }
  try {
    const run = await new TelemetrySnapshotService(store(), ctx.deps.clock).preview(ctx.cut);
    ctx.diag.preview = { executed: true, skip_reason: null };
    recordRun(ctx.diag, run, 'preview');
  } catch (error) {
    recordFailure(ctx.diag, 'local_preview', errorCodeOf(error, 'PREVIEW_FAILED'), error);
    return EXIT_FAILURE;
  }
  const cutoff = computePurgeCutoff(ctx.now);
  if (cutoff === null) return EXIT_OK;
  ctx.diag.purge = { executed: true, cutoff: cutoff.date, deleted: null };
  try {
    ctx.diag.purge.deleted = (await runPurge(store(), ctx.args.environment, cutoff)).deleted;
    return EXIT_OK;
  } catch (error) {
    recordFailure(ctx.diag, 'purge', 'PURGE_FAILED', error);
    return EXIT_FAILURE;
  }
}

async function runSample(ctx: RunContext, store: () => TelemetryCliStore): Promise<number> {
  const healthUrl = `${ctx.apiBaseUrl.replace(/\/+$/, '')}/health`;
  let api: ApiProbeOutcome;
  try {
    api = await ctx.deps.probeApi(healthUrl, API_PROBE_TIMEOUT_MS);
  } catch (error) {
    recordFailure(ctx.diag, 'api_health_probe', errorCodeOf(error, 'API_HEALTH_PROBE_FAILED'), error);
    return EXIT_FAILURE;
  }
  const measuredAt = ctx.deps.clock();
  const bucket = scheduledBucket(measuredAt);
  ctx.diag.bucket = bucket.toISOString();
  const sample = sampleRequest(api, measuredAt, bucket, ctx.args.date);

  if (api.kind !== 'response') return runDirectSample(ctx, sample, apiFailureReason(api), store);
  try {
    const result = await ctx.deps.apiClient(ctx.apiBaseUrl, ctx.internalToken).sample(sample);
    recordApiSample(ctx.diag, result);
    return EXIT_OK;
  } catch (error) {
    if (!(error instanceof KpiTransportError)) {
      recordFailure(ctx.diag, 'api_sample', errorCodeOf(error, 'API_SAMPLE_FAILED'), error);
      return EXIT_FAILURE;
    }
    return runDirectSample(ctx, sample, null, store);
  }
}

async function runFinalize(ctx: RunContext, store: () => TelemetryCliStore): Promise<number> {
  try {
    const result = await ctx.deps.apiClient(ctx.apiBaseUrl, ctx.internalToken).finalize(ctx.cut.date, ctx.args.environment);
    ctx.diag.reused = result.reused;
    ctx.diag.kpis = kpisOf(result.results, 'final');
    ctx.diag.counts = result.aggregates ? countsOf(result.aggregates) : null;
    return EXIT_OK;
  } catch (error) {
    if (!(error instanceof KpiTransportError)) {
      recordFailure(ctx.diag, 'api_finalize', errorCodeOf(error, 'FINALIZE_FAILED'), error);
      return EXIT_FAILURE;
    }
    try {
      const run = await new TelemetrySnapshotService(store(), ctx.deps.clock).finalizeCore(ctx.cut);
      ctx.diag.reused = run.reused;
      recordRun(ctx.diag, run, 'final');
      return EXIT_OK;
    } catch (fallbackError) {
      recordFailure(ctx.diag, 'local_finalize', errorCodeOf(fallbackError, 'FINALIZE_FAILED'), fallbackError);
      return EXIT_FAILURE;
    }
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
    failure: null,
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
      recordFailure(diag, 'validation', error.code, error);
      exitCode = EXIT_USAGE;
    } else {
      recordFailure(diag, 'runtime', 'UNEXPECTED_ERROR', error);
      exitCode = EXIT_FAILURE;
    }
  } finally {
    const store = opened as TelemetryCliStore | null;
    if (store !== null) await store.close().catch(() => undefined);
    diag.exit_code = exitCode;
    diag.finished_at = deps.clock().toISOString();
    if (diag.failure !== null && exitCode === EXIT_FAILURE) {
      console.error(`KPI_TELEMETRY_FAILED ${JSON.stringify(diag.failure)}`);
    }
    if (diagnosticsDir !== undefined) {
      try {
        await deps.writeDiagnostics(diagnosticsDir, diag);
      } catch {
        recordFailure(diag, 'diagnostics_write', 'DIAGNOSTICS_WRITE_FAILED');
        diag.exit_code = EXIT_FAILURE;
        exitCode = EXIT_FAILURE;
        console.error('KPI_DIAGNOSTICS_WRITE_FAILED');
        // Un fallo al escribir el diagnóstico no cambia el código de salida.
      }
    }
  }
  return exitCode;
}

// El abort cubre también la lectura del body.
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
    const instrumentation = instrumentationOf(response.headers.get('x-kpi-instrumentation'));
    return { kind: 'response', status: response.status, body, instrumentation };
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
    apiClient: (baseUrl, token) => new KpiApiClient(baseUrl, token),
    openStore: createReportingStore,
    writeDiagnostics: writeDiagnosticsFile,
  };
}
