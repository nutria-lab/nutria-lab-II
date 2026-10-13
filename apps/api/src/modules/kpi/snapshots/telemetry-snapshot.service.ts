// NUT-85 — Snapshots de telemetría (design D13, D14).
// - preview: agregados ⇒ fórmulas ⇒ upsert de los 8 del corte, en UNA transacción.
// - finalizeCore: REPEATABLE READ; 8 finales ⇒ se devuelven sin recalcular; 1..7 ⇒ KPI_FINAL_INCOMPLETE;
//   0 ⇒ cálculo en el mismo snapshot + INSERT plano. 23505/40001 ⇒ nueva transacción que lee los del ganador.
//   Máximo FINALIZE_MAX_ATTEMPTS transacciones; agotadas ⇒ KPI_FINALIZE_CONFLICT.
import type { PrismaClient } from '../../../generated/prisma/client';
import { TELEMETRY_KPI_IDS, buildTelemetryResults } from '../calc/telemetry-formulas';
import type { TelemetryAggregates, TelemetryWindow } from '../calc/telemetry-formulas';
import { sqlStateOf } from '../events/kpi-event-writer';
import type { KpiEnvironment, KpiResult } from '../kpi-contract';
import { TelemetryRepository } from '../repo/telemetry.repository';

export const FINALIZE_MAX_ATTEMPTS = 3;

export type SnapshotIsolation = 'ReadCommitted' | 'RepeatableRead';

export interface SnapshotCut {
  environment: KpiEnvironment;
  /** YYYY-MM-DD local (report_date). */
  date: string;
  start: Date;
  end: Date;
}

export interface SnapshotTx {
  loadAggregates(environment: KpiEnvironment, window: TelemetryWindow): Promise<TelemetryAggregates>;
  readFinals(cut: SnapshotCut): Promise<KpiResult[]>;
  insertFinals(cut: SnapshotCut, results: readonly KpiResult[]): Promise<void>;
  upsertPreviews(cut: SnapshotCut, results: readonly KpiResult[]): Promise<void>;
}

export interface SnapshotStore {
  transaction<T>(isolation: SnapshotIsolation, fn: (tx: SnapshotTx) => Promise<T>): Promise<T>;
}

export interface SnapshotRun {
  results: KpiResult[];
  reused: boolean;
  /** Agregados del cálculo (para el diagnóstico); null si se reutilizaron finales. */
  aggregates: TelemetryAggregates | null;
}

export type KpiSnapshotErrorCode = 'KPI_FINAL_INCOMPLETE' | 'KPI_FINALIZE_CONFLICT';

export class KpiSnapshotError extends Error {
  constructor(readonly code: KpiSnapshotErrorCode) {
    super(code);
    this.name = 'KpiSnapshotError';
  }
}

export interface TelemetrySnapshotOptions {
  /** Barrera inyectable entre la lectura de finales y la inserción (tests de concurrencia, G3). */
  afterFinalsRead?: (attempt: number) => Promise<void>;
}

const CONFLICT_SQLSTATES: readonly string[] = ['23505', '40001'];
/** Códigos de Prisma equivalentes: P2002 (unique) y P2034 (conflicto de escritura/deadlock). */
const PRISMA_CONFLICT_CODES: Readonly<Record<string, string>> = { P2002: '23505', P2034: '40001' };

function isConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CONFLICT_SQLSTATES.includes(code);
}

/** Normaliza un conflicto real de Prisma/adapter-pg a { code: '23505' | '40001' }, sin el mensaje original. */
export function normalizeConflictError(error: unknown): unknown {
  if (error instanceof KpiSnapshotError) return error;
  const sqlState = sqlStateOf(error);
  if (sqlState !== null && CONFLICT_SQLSTATES.includes(sqlState)) return conflictError(sqlState);
  const prismaCode = (error as { code?: unknown } | null)?.code;
  if (typeof prismaCode === 'string' && prismaCode in PRISMA_CONFLICT_CODES) {
    return conflictError(PRISMA_CONFLICT_CODES[prismaCode]);
  }
  return error;
}

function conflictError(code: string): Error & { code: string } {
  return Object.assign(new Error('KPI_SNAPSHOT_CONFLICT'), { code });
}

/** Store sobre Prisma: cada transacción usa un TelemetryRepository sobre el cliente de transacción. */
export class PrismaSnapshotStore implements SnapshotStore {
  constructor(private readonly prisma: PrismaClient) {}

  async transaction<T>(isolation: SnapshotIsolation, fn: (tx: SnapshotTx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(tx => fn(new TelemetryRepository(tx)), {
        isolationLevel: isolation,
        maxWait: 5000,
        timeout: 30_000,
      });
    } catch (error) {
      throw normalizeConflictError(error);
    }
  }
}

export class TelemetrySnapshotService {
  constructor(
    private readonly store: SnapshotStore,
    private readonly clock: () => Date,
    private readonly options: TelemetrySnapshotOptions = {},
  ) {}

  preview(cut: SnapshotCut): Promise<SnapshotRun> {
    return this.store.transaction('ReadCommitted', async tx => {
      const aggregates = await tx.loadAggregates(cut.environment, { start: cut.start, end: cut.end });
      const results = buildTelemetryResults(aggregates, cut, this.clock());
      await tx.upsertPreviews(cut, results);
      return { results, reused: false, aggregates };
    });
  }

  async finalizeCore(cut: SnapshotCut): Promise<SnapshotRun> {
    for (let attempt = 1; attempt <= FINALIZE_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.store.transaction('RepeatableRead', tx => this.finalizeAttempt(tx, cut, attempt));
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
    throw new KpiSnapshotError('KPI_FINALIZE_CONFLICT');
  }

  private async finalizeAttempt(tx: SnapshotTx, cut: SnapshotCut, attempt: number): Promise<SnapshotRun> {
    const finals = await tx.readFinals(cut);
    if (finals.length === TELEMETRY_KPI_IDS.length) return { results: finals, reused: true, aggregates: null };
    if (finals.length > 0) throw new KpiSnapshotError('KPI_FINAL_INCOMPLETE');
    await this.options.afterFinalsRead?.(attempt);
    const aggregates = await tx.loadAggregates(cut.environment, { start: cut.start, end: cut.end });
    const results = buildTelemetryResults(aggregates, cut, this.clock());
    await tx.insertFinals(cut, results);
    return { results, reused: false, aggregates };
  }
}
