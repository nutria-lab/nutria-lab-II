// finalizeCore: ante 23505/40001 reintenta en una transacción nueva que devuelve los finales del ganador.
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
  // null si se reutilizaron finales.
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
  // Barrera inyectable para los tests de concurrencia.
  afterFinalsRead?: (attempt: number) => Promise<void>;
}

const CONFLICT_SQLSTATES: readonly string[] = ['23505', '40001'];
/** Códigos de Prisma equivalentes: P2002 (unique) y P2034 (conflicto de escritura/deadlock). */
const PRISMA_CONFLICT_CODES: Readonly<Record<string, string>> = { P2002: '23505', P2034: '40001' };

function isConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CONFLICT_SQLSTATES.includes(code);
}

// Normaliza el conflicto a { code } sin el mensaje original.
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

  readCompleteFinals(cut: SnapshotCut): Promise<KpiResult[] | null> {
    return this.store.transaction('ReadCommitted', async tx => {
      const finals = await tx.readFinals(cut);
      return finals.length === TELEMETRY_KPI_IDS.length ? finals : null;
    });
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
