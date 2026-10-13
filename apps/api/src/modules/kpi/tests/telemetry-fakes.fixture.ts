import { TELEMETRY_KPI_IDS } from '../calc/telemetry-formulas';
import type { TelemetryAggregates } from '../calc/telemetry-formulas';
import type { KpiEnvironment, KpiResult } from '../kpi-contract';
import type {
  SnapshotCut,
  SnapshotIsolation,
  SnapshotStore,
  SnapshotTx,
} from '../snapshots/telemetry-snapshot.service';

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

/** Los 8 finales "ya guardados" con un measured_at reconocible. */
export function storedFinals(measuredAt: string, value = 7): KpiResult[] {
  return TELEMETRY_KPI_IDS.map(kpiId => ({
    kpi_id: kpiId,
    value: kpiId === 'health_status' ? 1 : value,
    quality: 'observed' as const,
    reason: null,
    sample_count: 4,
    measured_at: measuredAt,
  }));
}

export function pgError(code: string): Error & { code: string } {
  return Object.assign(new Error(`simulated ${code}`), { code });
}

export interface FakeTxCalls {
  loadAggregates: jest.Mock;
  readFinals: jest.Mock;
  insertFinals: jest.Mock;
  upsertPreviews: jest.Mock;
}

/**
 * Store en memoria. `readFinalsQueue` define lo que devuelve readFinals en cada transacción sucesiva
 * (el último valor se repite). `insertFinalsErrors` define los errores de insertFinals por intento.
 */
export class FakeSnapshotStore implements SnapshotStore {
  readonly isolations: SnapshotIsolation[] = [];
  readonly calls: FakeTxCalls;
  readFinalsQueue: KpiResult[][] = [[]];
  insertFinalsErrors: (Error | null)[] = [];
  transactionError: Error | null = null;
  private readCount = 0;
  private insertCount = 0;

  constructor(aggregates: (environment: KpiEnvironment, cut: { start: Date; end: Date }) => TelemetryAggregates) {
    this.calls = {
      loadAggregates: jest.fn(async (environment: KpiEnvironment, window: { start: Date; end: Date }) =>
        aggregates(environment, window),
      ),
      readFinals: jest.fn(async (_cut: SnapshotCut) => {
        const index = Math.min(this.readCount, this.readFinalsQueue.length - 1);
        this.readCount += 1;
        return this.readFinalsQueue[index];
      }),
      insertFinals: jest.fn(async (_cut: SnapshotCut, _results: readonly KpiResult[]) => {
        const error = this.insertFinalsErrors[this.insertCount] ?? null;
        this.insertCount += 1;
        if (error) throw error;
      }),
      upsertPreviews: jest.fn(async (_cut: SnapshotCut, _results: readonly KpiResult[]) => undefined),
    };
  }

  async transaction<T>(isolation: SnapshotIsolation, fn: (tx: SnapshotTx) => Promise<T>): Promise<T> {
    this.isolations.push(isolation);
    if (this.transactionError) throw this.transactionError;
    const tx: SnapshotTx = {
      loadAggregates: this.calls.loadAggregates,
      readFinals: this.calls.readFinals,
      insertFinals: this.calls.insertFinals,
      upsertPreviews: this.calls.upsertPreviews,
    };
    return fn(tx);
  }
}

/** Reloj que avanza 1 ms por lectura a partir de `start`. */
export function steppingClock(startIso: string): jest.Mock<Date, []> {
  let ms = Date.parse(startIso);
  return jest.fn(() => new Date(ms++));
}
