// NUT-85 — Fórmulas puras: agregados de la ventana [start, end) → KpiResult (design D12, §6.9).
// Sin DB, sin red, sin redondeo. Un valor no finito es un error de programación (KPI_NON_FINITE).
import type { KpiId, KpiResult } from '../kpi-contract';

/** Los 8 KPI de Telemetry, ordenados por kpi_id. */
export const TELEMETRY_KPI_IDS = [
  'availability_rate',
  'dependency_error_rate',
  'error_rate',
  'health_status',
  'last_success_age_seconds',
  'latency_p95_ms',
  'operations_count',
  'timeout_rate',
] as const satisfies readonly KpiId[];

export type TelemetryKpiId = (typeof TELEMETRY_KPI_IDS)[number];

export type HealthOutcome = 'healthy' | 'unhealthy' | 'unknown';

export interface TelemetryAggregates {
  /** Eventos HTTP terminales con finished_at en ventana, por outcome. */
  http: {
    success: number;
    clientError: number;
    serverError: number;
    networkError: number;
    timeout: number;
    other: number;
    /** percentile_disc(0.95) de duration_ms; null si no hay operaciones. */
    p95DurationMs: number | null;
    /** Sólo diagnóstico: no entra en ningún KPI. */
    pendingIncomplete: number;
  };
  /** max(finished_at) de success con finished_at < end (sin límite inferior). */
  lastSuccessFinishedAt: Date | null;
  /** Intentos de dependencias terminales con finished_at en ventana. */
  dependency: { success: number; error: number; timeout: number };
  /** Muestra de salud con mayor measured_at en ventana (desempate por scheduled_for). */
  latestHealth: { outcome: HealthOutcome; measuredAt: Date; scheduledFor: Date } | null;
  /** Muestras de salud con measured_at en ventana, por outcome. */
  health: { healthy: number; unhealthy: number; unknown: number };
  /** Muestras de salud con measured_at en ventana y reason INSTRUMENTATION_DISABLED (D31). */
  instrumentationDisabledSamples: number;
}

export const INSTRUMENTATION_DISABLED = 'INSTRUMENTATION_DISABLED';

/** KPI que dependen de eventos: sin instrumentación en la ventana no se publican como observed (D31). */
const EVENT_KPI_IDS = [
  'operations_count',
  'error_rate',
  'timeout_rate',
  'latency_p95_ms',
  'last_success_age_seconds',
  'dependency_error_rate',
] as const satisfies readonly TelemetryKpiId[];

export interface TelemetryWindow {
  start: Date;
  end: Date;
}

export const HEALTH_SAMPLE_MAX_AGE_MS = 60 * 60 * 1000;

export function assertFinite(kpiId: KpiId, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`KPI_NON_FINITE: ${kpiId}`);
  }
  return value;
}

type Draft = Omit<KpiResult, 'kpi_id' | 'measured_at'>;

function observed(kpiId: KpiId, value: number, sampleCount: number): Draft {
  return { value: assertFinite(kpiId, value), quality: 'observed', reason: null, sample_count: sampleCount };
}

function unavailable(reason: string, sampleCount = 0): Draft {
  return { value: null, quality: 'unavailable', reason, sample_count: sampleCount };
}

function percentage(part: number, total: number): number {
  return (part / total) * 100;
}

function healthStatus(a: TelemetryAggregates, window: TelemetryWindow): Draft {
  const latest = a.latestHealth;
  if (!latest) return unavailable('NO_HEALTH_SAMPLE');
  if (latest.outcome === 'unknown') return unavailable('HEALTH_UNKNOWN');
  const age = assertFinite('health_status', window.end.getTime() - latest.measuredAt.getTime());
  if (age > HEALTH_SAMPLE_MAX_AGE_MS) return unavailable('HEALTH_SAMPLE_STALE');
  return observed('health_status', latest.outcome === 'healthy' ? 1 : 0, 1);
}

export function buildTelemetryResults(
  a: TelemetryAggregates,
  window: TelemetryWindow,
  measuredAt: Date,
): KpiResult[] {
  const { http } = a;
  const n = http.success + http.clientError + http.serverError + http.networkError + http.timeout + http.other;
  const errors = http.serverError + http.networkError + http.timeout;
  const attempts = a.dependency.success + a.dependency.error + a.dependency.timeout;
  const validHealth = a.health.healthy + a.health.unhealthy;

  const drafts: Record<TelemetryKpiId, Draft> = {
    operations_count: observed('operations_count', n, n),
    error_rate: n === 0 ? unavailable('NO_OPERATIONS') : observed('error_rate', percentage(errors, n), n),
    timeout_rate: n === 0 ? unavailable('NO_OPERATIONS') : observed('timeout_rate', percentage(http.timeout, n), n),
    latency_p95_ms:
      n === 0 || http.p95DurationMs === null
        ? unavailable('NO_OPERATIONS')
        : observed('latency_p95_ms', http.p95DurationMs, n),
    last_success_age_seconds:
      a.lastSuccessFinishedAt === null
        ? unavailable('NO_SUCCESS_KNOWN')
        : observed(
            'last_success_age_seconds',
            (window.end.getTime() - a.lastSuccessFinishedAt.getTime()) / 1000,
            1,
          ),
    dependency_error_rate:
      attempts === 0
        ? unavailable('NO_DEPENDENCY_ATTEMPTS')
        : observed('dependency_error_rate', percentage(a.dependency.error + a.dependency.timeout, attempts), attempts),
    health_status: healthStatus(a, window),
    availability_rate:
      validHealth === 0
        ? unavailable('NO_VALID_HEALTH_SAMPLES')
        : observed('availability_rate', percentage(a.health.healthy, validHealth), validHealth),
  };

  if (a.instrumentationDisabledSamples > 0) {
    for (const kpiId of EVENT_KPI_IDS) drafts[kpiId] = unavailable(INSTRUMENTATION_DISABLED);
  }

  const measuredAtIso = measuredAt.toISOString();
  return TELEMETRY_KPI_IDS.map(kpiId => ({ kpi_id: kpiId, ...drafts[kpiId], measured_at: measuredAtIso }));
}
