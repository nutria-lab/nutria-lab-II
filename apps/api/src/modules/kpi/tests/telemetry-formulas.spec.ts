import type { KpiResult } from '../kpi-contract';
import {
  TELEMETRY_KPI_IDS,
  TelemetryAggregates,
  assertFinite,
  buildTelemetryResults,
} from '../calc/telemetry-formulas';

const WINDOW = {
  start: new Date('2026-10-09T03:00:00.000Z'),
  end: new Date('2026-10-10T00:00:00.000Z'),
};
const MEASURED_AT = new Date('2026-10-10T00:05:00.000Z');
const MINUTE_MS = 60_000;

function emptyAggregates(): TelemetryAggregates {
  return {
    http: {
      success: 0,
      clientError: 0,
      serverError: 0,
      networkError: 0,
      timeout: 0,
      other: 0,
      p95DurationMs: null,
      pendingIncomplete: 0,
    },
    lastSuccessFinishedAt: null,
    dependency: { success: 0, error: 0, timeout: 0 },
    latestHealth: null,
    health: { healthy: 0, unhealthy: 0, unknown: 0 },
    instrumentationDisabledSamples: 0,
  };
}

function aggregates(patch: (a: TelemetryAggregates) => void): TelemetryAggregates {
  const a = emptyAggregates();
  patch(a);
  return a;
}

function build(a: TelemetryAggregates): KpiResult[] {
  return buildTelemetryResults(a, WINDOW, MEASURED_AT);
}

function pick(results: readonly KpiResult[], kpiId: KpiResult['kpi_id']): KpiResult {
  const found = results.filter(r => r.kpi_id === kpiId);
  expect(found).toHaveLength(1);
  return found[0];
}

function expectUnavailable(result: KpiResult, reason: string): void {
  expect(result.quality).toBe('unavailable');
  expect(result.value).toBeNull();
  expect(result.reason).toBe(reason);
}

function expectObserved(result: KpiResult, value: number, sampleCount: number): void {
  expect(result.quality).toBe('observed');
  expect(result.value).toBe(value);
  expect(result.reason).toBeNull();
  expect(result.sample_count).toBe(sampleCount);
}

describe('telemetry-formulas — forma del resultado', () => {
  it('TELEMETRY_KPI_IDS son exactamente los 8 códigos de Telemetry ordenados', () => {
    expect([...TELEMETRY_KPI_IDS]).toEqual([
      'availability_rate',
      'dependency_error_rate',
      'error_rate',
      'health_status',
      'last_success_age_seconds',
      'latency_p95_ms',
      'operations_count',
      'timeout_rate',
    ]);
  });

  it('devuelve exactamente los 8 códigos de Telemetry ordenados por kpi_id, con measured_at ISO del cálculo', () => {
    const results = build(emptyAggregates());

    expect(results.map(r => r.kpi_id)).toEqual([...TELEMETRY_KPI_IDS]);
    for (const result of results) {
      expect(result.measured_at).toBe('2026-10-10T00:05:00.000Z');
      expect(Number.isInteger(result.sample_count)).toBe(true);
      expect(result.sample_count).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('telemetry-formulas — F2 tráfico HTTP', () => {
  it('10 operaciones con 1 timeout y 1 server_error ⇒ error_rate 20, timeout_rate 10, operations_count 10', () => {
    const results = build(
      aggregates(a => {
        a.http.success = 8;
        a.http.timeout = 1;
        a.http.serverError = 1;
        a.http.p95DurationMs = 120;
      }),
    );

    expectObserved(pick(results, 'operations_count'), 10, 10);
    expectObserved(pick(results, 'error_rate'), 20, 10);
    expectObserved(pick(results, 'timeout_rate'), 10, 10);
  });

  it('network_error también es error', () => {
    const results = build(
      aggregates(a => {
        a.http.success = 3;
        a.http.networkError = 1;
        a.http.p95DurationMs = 5;
      }),
    );

    expectObserved(pick(results, 'error_rate'), 25, 4);
    expectObserved(pick(results, 'timeout_rate'), 0, 4);
  });

  it('client_error (4xx) y other suman al denominador pero no a errores', () => {
    const results = build(
      aggregates(a => {
        a.http.success = 6;
        a.http.timeout = 1;
        a.http.serverError = 1;
        a.http.clientError = 1;
        a.http.other = 1;
        a.http.p95DurationMs = 120;
      }),
    );

    expectObserved(pick(results, 'operations_count'), 10, 10);
    expectObserved(pick(results, 'error_rate'), 20, 10);
    expectObserved(pick(results, 'timeout_rate'), 10, 10);
  });

  it('los pending incompletos no entran en ningún KPI', () => {
    const base = aggregates(a => {
      a.http.success = 8;
      a.http.timeout = 1;
      a.http.serverError = 1;
      a.http.p95DurationMs = 120;
    });
    const withPending = aggregates(a => {
      Object.assign(a.http, base.http, { pendingIncomplete: 7 });
    });

    expect(build(withPending)).toEqual(build(base));
  });

  it('0 operaciones ⇒ operations_count observed 0 y error/timeout/p95 unavailable NO_OPERATIONS', () => {
    const results = build(emptyAggregates());

    expectObserved(pick(results, 'operations_count'), 0, 0);
    for (const id of ['error_rate', 'timeout_rate', 'latency_p95_ms'] as const) {
      expectUnavailable(pick(results, id), 'NO_OPERATIONS');
      expect(pick(results, id).sample_count).toBe(0);
    }
  });
});

describe('telemetry-formulas — F1 p95', () => {
  it('el p95 del agregado (percentile_disc de Postgres) pasa tal cual', () => {
    const results = build(
      aggregates(a => {
        a.http.success = 20;
        a.http.p95DurationMs = 19;
      }),
    );

    expectObserved(pick(results, 'latency_p95_ms'), 19, 20);
  });

  it('no redondea un p95 con decimales', () => {
    const results = build(
      aggregates(a => {
        a.http.success = 1;
        a.http.p95DurationMs = 12.375;
      }),
    );

    expectObserved(pick(results, 'latency_p95_ms'), 12.375, 1);
  });
});

describe('telemetry-formulas — F3 dependencias', () => {
  it('2 fallos (error + timeout) sobre 8 intentos ⇒ dependency_error_rate 25', () => {
    const results = build(
      aggregates(a => {
        a.dependency = { success: 6, error: 1, timeout: 1 };
      }),
    );

    expectObserved(pick(results, 'dependency_error_rate'), 25, 8);
  });

  it('0 intentos ⇒ unavailable NO_DEPENDENCY_ATTEMPTS', () => {
    const result = pick(build(emptyAggregates()), 'dependency_error_rate');

    expectUnavailable(result, 'NO_DEPENDENCY_ATTEMPTS');
    expect(result.sample_count).toBe(0);
  });
});

describe('telemetry-formulas — F4 last_success_age_seconds', () => {
  it('éxito anterior a start ⇒ (end − finished_at) / 1000, sample_count 1', () => {
    const results = build(
      aggregates(a => {
        a.lastSuccessFinishedAt = new Date('2026-10-08T23:00:00.000Z'); // antes de start
      }),
    );

    expectObserved(pick(results, 'last_success_age_seconds'), 90_000, 1);
  });

  it('éxito dentro de la ventana con milisegundos ⇒ segundos sin redondeo', () => {
    const results = build(
      aggregates(a => {
        a.http.success = 1;
        a.http.p95DurationMs = 10;
        a.lastSuccessFinishedAt = new Date('2026-10-09T23:59:58.500Z');
      }),
    );

    expectObserved(pick(results, 'last_success_age_seconds'), 1.5, 1);
  });

  it('sin éxito conocido ⇒ unavailable NO_SUCCESS_KNOWN, sample_count 0', () => {
    const result = pick(build(emptyAggregates()), 'last_success_age_seconds');

    expectUnavailable(result, 'NO_SUCCESS_KNOWN');
    expect(result.sample_count).toBe(0);
  });
});

describe('telemetry-formulas — F5 health_status', () => {
  const sample = (outcome: 'healthy' | 'unhealthy' | 'unknown', minutesBeforeEnd: number) => ({
    outcome,
    measuredAt: new Date(WINDOW.end.getTime() - minutesBeforeEnd * MINUTE_MS),
    scheduledFor: new Date(WINDOW.end.getTime() - Math.ceil(minutesBeforeEnd / 30) * 30 * MINUTE_MS),
  });

  it('última muestra healthy ⇒ 1, sample_count 1', () => {
    const results = build(aggregates(a => (a.latestHealth = sample('healthy', 5))));

    expectObserved(pick(results, 'health_status'), 1, 1);
  });

  it('última muestra unhealthy ⇒ 0 observed (un 0 medido conserva observed)', () => {
    const results = build(aggregates(a => (a.latestHealth = sample('unhealthy', 5))));

    expectObserved(pick(results, 'health_status'), 0, 1);
  });

  it('última muestra unknown ⇒ unavailable HEALTH_UNKNOWN (sin buscar una anterior)', () => {
    const result = pick(build(aggregates(a => (a.latestHealth = sample('unknown', 5)))), 'health_status');

    expectUnavailable(result, 'HEALTH_UNKNOWN');
  });

  it('más de 60 min antes del corte ⇒ unavailable HEALTH_SAMPLE_STALE', () => {
    const latest = {
      outcome: 'healthy' as const,
      measuredAt: new Date(WINDOW.end.getTime() - 60 * MINUTE_MS - 1),
      scheduledFor: new Date(WINDOW.end.getTime() - 90 * MINUTE_MS),
    };
    const result = pick(build(aggregates(a => (a.latestHealth = latest))), 'health_status');

    expectUnavailable(result, 'HEALTH_SAMPLE_STALE');
  });

  it('exactamente 60 min antes del corte ⇒ válida', () => {
    const results = build(aggregates(a => (a.latestHealth = sample('healthy', 60))));

    expectObserved(pick(results, 'health_status'), 1, 1);
  });

  it('sin muestras ⇒ unavailable NO_HEALTH_SAMPLE, sample_count 0', () => {
    const result = pick(build(emptyAggregates()), 'health_status');

    expectUnavailable(result, 'NO_HEALTH_SAMPLE');
    expect(result.sample_count).toBe(0);
  });
});

describe('telemetry-formulas — F6 availability_rate', () => {
  it('2 healthy + 1 unhealthy (+1 unknown) ⇒ 66.666… sin redondeo, sample_count 3', () => {
    const results = build(aggregates(a => (a.health = { healthy: 2, unhealthy: 1, unknown: 1 })));

    expectObserved(pick(results, 'availability_rate'), (2 / 3) * 100, 3);
    expect(pick(results, 'availability_rate').value).toBeCloseTo(66.6666666667, 9);
  });

  it('unknown no cuenta como healthy ni como caída', () => {
    const without = pick(build(aggregates(a => (a.health = { healthy: 2, unhealthy: 1, unknown: 0 }))), 'availability_rate');
    const withMany = pick(build(aggregates(a => (a.health = { healthy: 2, unhealthy: 1, unknown: 9 }))), 'availability_rate');

    expect(withMany).toEqual(without);
  });

  it('todas unhealthy ⇒ 0 observed', () => {
    expectObserved(pick(build(aggregates(a => (a.health = { healthy: 0, unhealthy: 2, unknown: 0 }))), 'availability_rate'), 0, 2);
  });

  it('sólo unknown ⇒ unavailable NO_VALID_HEALTH_SAMPLES', () => {
    const result = pick(build(aggregates(a => (a.health = { healthy: 0, unhealthy: 0, unknown: 3 }))), 'availability_rate');

    expectUnavailable(result, 'NO_VALID_HEALTH_SAMPLES');
    expect(result.sample_count).toBe(0);
  });

  it('sin muestras ⇒ unavailable NO_VALID_HEALTH_SAMPLES', () => {
    expectUnavailable(pick(build(emptyAggregates()), 'availability_rate'), 'NO_VALID_HEALTH_SAMPLES');
  });
});

describe('telemetry-formulas — F7 calidad y valores no finitos', () => {
  it('todo unavailable tiene value null y reason no vacío; todo observed tiene value finito ≥ 0 y reason null', () => {
    const scenarios = [
      emptyAggregates(),
      aggregates(a => {
        a.http.success = 8;
        a.http.timeout = 1;
        a.http.serverError = 1;
        a.http.p95DurationMs = 0;
        a.lastSuccessFinishedAt = new Date('2026-10-09T23:00:00.000Z');
        a.dependency = { success: 0, error: 0, timeout: 4 };
        a.latestHealth = {
          outcome: 'unhealthy',
          measuredAt: new Date('2026-10-09T23:40:00.000Z'),
          scheduledFor: new Date('2026-10-09T23:30:00.000Z'),
        };
        a.health = { healthy: 0, unhealthy: 1, unknown: 0 };
      }),
    ];

    for (const scenario of scenarios) {
      for (const result of build(scenario)) {
        if (result.quality === 'unavailable') {
          expect(result.value).toBeNull();
          expect(typeof result.reason).toBe('string');
          expect((result.reason as string).trim().length).toBeGreaterThan(0);
        } else {
          expect(result.quality).toBe('observed');
          expect(Number.isFinite(result.value)).toBe(true);
          expect(result.value as number).toBeGreaterThanOrEqual(0);
          expect(result.reason).toBeNull();
        }
      }
    }
  });

  it('un 0 medido queda observed (p95 = 0, timeout_rate 0)', () => {
    const results = build(
      aggregates(a => {
        a.http.success = 5;
        a.http.p95DurationMs = 0;
      }),
    );

    expectObserved(pick(results, 'latency_p95_ms'), 0, 5);
    expectObserved(pick(results, 'error_rate'), 0, 5);
    expectObserved(pick(results, 'timeout_rate'), 0, 5);
  });

  it.each([NaN, Infinity, -Infinity])('p95 %p en el agregado ⇒ throw KPI_NON_FINITE (no se oculta como unavailable)', value => {
    const a = aggregates(x => {
      x.http.success = 3;
      x.http.p95DurationMs = value;
    });

    expect(() => build(a)).toThrow(/KPI_NON_FINITE/);
  });

  it('una fecha de último éxito inválida (NaN) ⇒ throw KPI_NON_FINITE', () => {
    const a = aggregates(x => (x.lastSuccessFinishedAt = new Date(Number.NaN)));

    expect(() => build(a)).toThrow(/KPI_NON_FINITE/);
  });

  it.each([NaN, Infinity, -Infinity])('assertFinite(%p) lanza KPI_NON_FINITE', value => {
    expect(() => assertFinite('error_rate', value)).toThrow(/KPI_NON_FINITE/);
  });

  it('assertFinite deja pasar 0 y valores finitos', () => {
    expect(() => assertFinite('operations_count', 0)).not.toThrow();
    expect(() => assertFinite('availability_rate', 66.66666666666667)).not.toThrow();
  });
});

// Instrumentación apagada ⇒ no publicar "observed 0".
// TelemetryAggregates.instrumentationDisabledSamples: number = muestras de salud con measured_at en [start, end)
// y reason 'INSTRUMENTATION_DISABLED'. Si > 0, los 6 KPI que dependen de eventos salen unavailable.
describe('telemetry-formulas — instrumentación apagada (INSTRUMENTATION_DISABLED)', () => {
  const EVENT_KPIS = [
    'operations_count',
    'error_rate',
    'timeout_rate',
    'latency_p95_ms',
    'last_success_age_seconds',
    'dependency_error_rate',
  ] as const;

  function withTraffic(disabledSamples: number): TelemetryAggregates {
    return aggregates(a => {
      a.http.success = 8;
      a.http.timeout = 1;
      a.http.serverError = 1;
      a.http.p95DurationMs = 120;
      a.lastSuccessFinishedAt = new Date(WINDOW.end.getTime() - 10 * MINUTE_MS);
      a.dependency = { success: 3, error: 1, timeout: 0 };
      a.latestHealth = {
        outcome: 'healthy',
        measuredAt: new Date(WINDOW.end.getTime() - 10 * MINUTE_MS),
        scheduledFor: new Date(WINDOW.end.getTime() - 30 * MINUTE_MS),
      };
      a.health = { healthy: 3, unhealthy: 1, unknown: 0 };
      a.instrumentationDisabledSamples = disabledSamples;
    });
  }

  it('sin datos y una muestra INSTRUMENTATION_DISABLED ⇒ los 6 KPI de eventos unavailable (no observed 0)', () => {
    const results = build(aggregates(a => (a.instrumentationDisabledSamples = 1)));

    for (const kpiId of EVENT_KPIS) {
      const result = pick(results, kpiId);
      expectUnavailable(result, 'INSTRUMENTATION_DISABLED');
      expect(result.sample_count).toBe(0);
    }
  });

  it('con tráfico y alguna muestra INSTRUMENTATION_DISABLED ⇒ los 6 KPI de eventos igual unavailable', () => {
    const results = build(withTraffic(2));

    for (const kpiId of EVENT_KPIS) {
      const result = pick(results, kpiId);
      expectUnavailable(result, 'INSTRUMENTATION_DISABLED');
      expect(result.sample_count).toBe(0);
    }
  });

  it('health_status y availability_rate no cambian por la instrumentación apagada', () => {
    const disabled = build(withTraffic(1));
    const enabled = build(withTraffic(0));

    expect(pick(disabled, 'health_status')).toEqual(pick(enabled, 'health_status'));
    expect(pick(disabled, 'availability_rate')).toEqual(pick(enabled, 'availability_rate'));
    expectObserved(pick(disabled, 'health_status'), 1, 1);
    expectObserved(pick(disabled, 'availability_rate'), 75, 4);
  });

  it('con 0 muestras INSTRUMENTATION_DISABLED: operations_count 0 sigue observed y el resto como antes', () => {
    const results = build(emptyAggregates());

    expectObserved(pick(results, 'operations_count'), 0, 0);
    expectUnavailable(pick(results, 'error_rate'), 'NO_OPERATIONS');
    expectUnavailable(pick(results, 'last_success_age_seconds'), 'NO_SUCCESS_KNOWN');
    expectUnavailable(pick(results, 'dependency_error_rate'), 'NO_DEPENDENCY_ATTEMPTS');
  });

  it('con 0 muestras INSTRUMENTATION_DISABLED y tráfico: los 6 KPI de eventos siguen observed', () => {
    const results = build(withTraffic(0));

    expectObserved(pick(results, 'operations_count'), 10, 10);
    expectObserved(pick(results, 'error_rate'), 20, 10);
    expectObserved(pick(results, 'timeout_rate'), 10, 10);
    expectObserved(pick(results, 'latency_p95_ms'), 120, 10);
    expectObserved(pick(results, 'last_success_age_seconds'), 600, 1);
    expectObserved(pick(results, 'dependency_error_rate'), 25, 4);
  });
});
