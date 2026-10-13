// Una falla de la fuente da 8 unavailable SOURCE_UNAVAILABLE sin persistir; los errores de contrato o de SQL estructural se propagan.
import { TELEMETRY_KPI_IDS } from './calc/telemetry-formulas';
import { computePurgeCutoff } from './cli/purge-policy';
import type { KpiConfig } from './config/kpi-config';
import type { CollectionContext, KpiLogger, KpiResult } from './kpi-contract';
import { sqlStateOf } from './events/kpi-event-writer';
import { KpiSnapshotError } from './snapshots/telemetry-snapshot.service';
import type { SnapshotCut, TelemetrySnapshotService } from './snapshots/telemetry-snapshot.service';
import { KpiWindowError, parseReportDate, windowForDate } from './window/kpi-window';
import type { KpiWindow } from './window/kpi-window';

export const SOURCE_UNAVAILABLE = 'SOURCE_UNAVAILABLE';
export const PURGED_WINDOW = 'PURGED_WINDOW';

export type KpiContextErrorCode =
  | 'KPI_CONTRACT_VERSION_MISMATCH'
  | 'KPI_ENV_MISMATCH'
  | 'KPI_CONTEXT_WINDOW_MISMATCH'
  | 'FUTURE_CUT'
  | 'INVALID_DATE';

export class KpiContextError extends Error {
  constructor(readonly code: KpiContextErrorCode) {
    super(code);
    this.name = 'KpiContextError';
  }
}

// Clase 42 y clase 23 salvo 23505: errores de programación, no de la fuente.
function isStructuralSqlState(sqlState: string | null): boolean {
  if (sqlState === null) return false;
  return sqlState.startsWith('42') || (sqlState.startsWith('23') && sqlState !== '23505');
}

function isSourceFailure(error: unknown): boolean {
  if (error instanceof KpiSnapshotError) return error.code === 'KPI_FINALIZE_CONFLICT';
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError) return false;
  if (isStructuralSqlState(sqlStateOf(error))) return false;
  return !(error instanceof Error && error.message.startsWith('KPI_NON_FINITE'));
}

// Orden por code points, independiente de la collation de la DB.
function byKpiId(a: KpiResult, b: KpiResult): number {
  if (a.kpi_id === b.kpi_id) return 0;
  return a.kpi_id < b.kpi_id ? -1 : 1;
}

function sameInstant(iso: string, expected: Date): boolean {
  return Date.parse(iso) === expected.getTime();
}

export class TelemetryLogger implements KpiLogger {
  constructor(
    private readonly core: Pick<TelemetrySnapshotService, 'finalizeCore' | 'readCompleteFinals'>,
    private readonly config: Pick<KpiConfig, 'environment'>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async collect(context: CollectionContext): Promise<readonly KpiResult[]> {
    const cut = this.validate(context);
    try {
      if (this.isPurged(cut)) {
        const finals = await this.core.readCompleteFinals(cut);
        return finals ? [...finals].sort(byKpiId) : this.unavailable(PURGED_WINDOW);
      }
      const run = await this.core.finalizeCore(cut);
      return [...run.results].sort(byKpiId);
    } catch (error) {
      if (!isSourceFailure(error)) throw error;
      return this.unavailable(SOURCE_UNAVAILABLE);
    }
  }

  private isPurged(cut: SnapshotCut): boolean {
    const cutoff = computePurgeCutoff(this.clock());
    return cutoff !== null && cut.date < cutoff.date;
  }

  private unavailable(reason: string): KpiResult[] {
    const measuredAt = this.clock().toISOString();
    return TELEMETRY_KPI_IDS.map(kpiId => ({
      kpi_id: kpiId,
      value: null,
      quality: 'unavailable' as const,
      reason,
      sample_count: 0,
      measured_at: measuredAt,
    }));
  }

  private validate(context: CollectionContext): SnapshotCut {
    if (context.contract_version !== '1') throw new KpiContextError('KPI_CONTRACT_VERSION_MISMATCH');
    if (this.config.environment === null || context.environment !== this.config.environment) {
      throw new KpiContextError('KPI_ENV_MISMATCH');
    }
    let window: KpiWindow;
    try {
      window = windowForDate(parseReportDate(context.date));
    } catch (error) {
      if (error instanceof KpiWindowError) throw new KpiContextError('INVALID_DATE');
      throw error;
    }
    if (!sameInstant(context.window_start, window.start) || !sameInstant(context.window_end, window.end)) {
      throw new KpiContextError('KPI_CONTEXT_WINDOW_MISMATCH');
    }
    if (window.end.getTime() > this.clock().getTime()) throw new KpiContextError('FUTURE_CUT');
    return { environment: context.environment, date: window.date, start: window.start, end: window.end };
  }
}
