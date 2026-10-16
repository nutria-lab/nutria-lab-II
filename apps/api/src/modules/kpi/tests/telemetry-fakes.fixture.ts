import type { TelemetryAggregates } from '../calc/telemetry-formulas';

/** Agregados con datos (todos los KPI observados con una ventana que termina a las 21:00 locales). */
export function sampleAggregates(windowEnd: Date): TelemetryAggregates {
  return {
    http: {
      success: 8,
      clientError: 1,
      serverError: 1,
      networkError: 0,
      timeout: 0,
      other: 0,
      p95DurationMs: 120,
      pendingIncomplete: 2,
    },
    lastSuccessFinishedAt: new Date(windowEnd.getTime() - 60_000),
    dependency: { success: 3, error: 1, timeout: 0 },
    latestHealth: {
      outcome: 'healthy',
      measuredAt: new Date(windowEnd.getTime() - 10 * 60_000),
      scheduledFor: new Date(windowEnd.getTime() - 30 * 60_000),
    },
    health: { healthy: 3, unhealthy: 1, unknown: 0 },
    instrumentationDisabledSamples: 0,
  };
}

export function pgError(code: string): Error & { code: string } {
  return Object.assign(new Error(`simulated ${code}`), { code });
}
