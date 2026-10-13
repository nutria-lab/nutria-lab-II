// NUT-85 — Escritor de eventos KPI (design D3, D5).
// - Cada escritura se espera como máximo KPI_WRITE_WAIT_MS y nunca rechaza.
// - Fallos ⇒ log con código técnico + SQLSTATE; nunca el mensaje del error ni la URL de conexión.
// - Las queries que exceden la espera quedan registradas "en vuelo"; drain(ms) las espera acotado al cerrar la app.
// - Cada escritura corre en su propia transacción con `SET LOCAL statement_timeout` previo (D27): nada de
//   parámetros de arranque (el pooler PgBouncer de Neon puede rechazarlos) y el límite no queda pegado a la conexión.
// - El cierre es un UPDATE condicional (outcome = 'pending') del mismo id: nunca INSERT (un segundo cierre afecta 0 filas).
import { Logger } from '@nestjs/common';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import type { KpiEnvironment } from '../kpi-contract';
import type { HttpTerminalOutcome } from '../http/http-outcome';
import type { DependencyTerminalOutcome, KpiDependency } from '../dependencies/dependency-instrumentation';

export const KPI_WRITE_WAIT_MS = 250;
export const KPI_SQL_STATEMENT_TIMEOUT_MS = 100;
export const KPI_DRAIN_TIMEOUT_MS = 1000;

export interface HttpPendingEvent {
  id: string;
  environment: KpiEnvironment;
  operation: string;
  startedAt: Date;
}

export interface HttpCloseEvent {
  id: string;
  operation: string;
  outcome: HttpTerminalOutcome;
  httpStatus: number | null;
  finishedAt: Date;
  durationMs: number;
}

export interface DependencyPendingEvent {
  id: string;
  environment: KpiEnvironment;
  operationId: string;
  dependency: KpiDependency;
  attempt: number;
  startedAt: Date;
}

export interface DependencyCloseEvent {
  id: string;
  outcome: DependencyTerminalOutcome;
  finishedAt: Date;
  durationMs: number;
}

export interface KpiEventWriter {
  insertHttpPending(event: HttpPendingEvent): Promise<void>;
  closeHttp(event: HttpCloseEvent): Promise<void>;
  insertDependencyPending(event: DependencyPendingEvent): Promise<void>;
  closeDependency(event: DependencyCloseEvent): Promise<void>;
  /** Espera (acotado) a que terminen las escrituras en vuelo. Nunca rechaza. */
  drain(timeoutMs?: number): Promise<void>;
  inFlightCount(): number;
  /** Libera recursos propios (pool). Opcional. */
  dispose?(): Promise<void>;
}

/** $executeRaw (tagged template, parametrizado), el SET LOCAL sin parámetros y $transaction en forma batch. */
export type KpiWriterClient = Pick<PrismaClient, '$executeRaw' | '$executeRawUnsafe' | '$transaction'>;

/** SET LOCAL no admite parámetros; el valor sale de una constante numérica, nunca de entrada externa. */
const SET_LOCAL_STATEMENT_TIMEOUT = `SET LOCAL statement_timeout = '${KPI_SQL_STATEMENT_TIMEOUT_MS}ms'`;

const logger = new Logger('KpiEventWriter');

const SQLSTATE_RE = /^[0-9A-Z]{5}$/;
const STATEMENT_TIMEOUT_SQLSTATE = '57014';

/** Busca el SQLSTATE de Postgres en el error (directo de pg o envuelto por Prisma/adapter-pg). */
export function sqlStateOf(error: unknown): string | null {
  const queue: Array<{ node: unknown; depth: number }> = [{ node: error, depth: 0 }];
  const seen = new Set<unknown>();
  let fallback: string | null = null;
  while (queue.length > 0) {
    const { node, depth } = queue.shift() as { node: unknown; depth: number };
    if (node === null || typeof node !== 'object' || seen.has(node) || depth > 4) continue;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (typeof record.originalCode === 'string' && SQLSTATE_RE.test(record.originalCode)) {
      return record.originalCode;
    }
    // Los errores de Prisma (con clientVersion) usan códigos propios tipo P2010: no son SQLSTATE.
    if (
      fallback === null &&
      typeof record.code === 'string' &&
      SQLSTATE_RE.test(record.code) &&
      !('clientVersion' in record)
    ) {
      fallback = record.code;
    }
    const children = [record.cause, record.meta, record.driverAdapterError, ...Object.values(record)];
    for (const child of children) queue.push({ node: child, depth: depth + 1 });
  }
  return fallback;
}

const PRISMA_CODE_RE = /^P\d{4}$/;
export const CLIENT_QUERY_TIMEOUT_CODE = 'CLIENT_QUERY_TIMEOUT';
export const CLIENT_CONNECT_TIMEOUT_CODE = 'CLIENT_CONNECT_TIMEOUT';

/**
 * Código técnico de un fallo sin SQLSTATE (D32): el `query_timeout`/connect timeout del cliente pg llega como
 * `Error` sin `code` (Prisma no lo envuelve), así que se reconoce por su texto fijo; el mensaje nunca se loguea.
 */
export function technicalCodeOf(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  if (typeof record.code === 'string' && PRISMA_CODE_RE.test(record.code)) return record.code;
  const message = typeof record.message === 'string' ? record.message : '';
  if (message === 'Query read timeout') return CLIENT_QUERY_TIMEOUT_CODE;
  if (/timeout exceeded when trying to connect|terminated due to connection timeout/i.test(message)) {
    return CLIENT_CONNECT_TIMEOUT_CODE;
  }
  return null;
}

function logWriteFailure(operation: string, error: unknown): void {
  const sqlState = sqlStateOf(error);
  const technicalCode = sqlState === null ? technicalCodeOf(error) : null;
  const isTimeout = sqlState === STATEMENT_TIMEOUT_SQLSTATE || technicalCode === CLIENT_QUERY_TIMEOUT_CODE;
  const code = isTimeout ? 'KPI_WRITE_TIMEOUT' : 'KPI_WRITE_FAILED';
  const suffix = technicalCode ? ` code=${technicalCode}` : '';
  logger.warn(`${code} op=${operation} sqlstate=${sqlState ?? 'none'}${suffix}`);
}

/**
 * Ejecuta una escritura y la espera como máximo `waitMs`. Nunca rechaza: un rechazo se loguea como
 * KPI_WRITE_FAILED/KPI_WRITE_TIMEOUT y el vencimiento como KPI_WRITE_WAIT_EXCEEDED. El temporizador siempre se limpia.
 */
export function awaitWriteBounded(
  write: () => Promise<unknown>,
  operation: string,
  waitMs: number = KPI_WRITE_WAIT_MS,
): Promise<void> {
  let settled: Promise<void>;
  try {
    settled = Promise.resolve(write()).then(
      () => undefined,
      error => logWriteFailure(operation, error),
    );
  } catch (error) {
    logWriteFailure(operation, error);
    return Promise.resolve();
  }
  return new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      logger.warn(`KPI_WRITE_WAIT_EXCEEDED op=${operation}`);
      resolve();
    }, waitMs);
    void settled.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export class PrismaKpiEventWriter implements KpiEventWriter {
  private readonly inFlight = new Set<Promise<void>>();
  /** INSERT pending por id, para encadenar el cierre después del insert de la misma request. */
  private readonly pendingInserts = new Map<string, Promise<void>>();

  constructor(
    private readonly client: KpiWriterClient,
    private readonly onDispose?: () => Promise<void>,
  ) {}

  insertHttpPending(event: HttpPendingEvent): Promise<void> {
    return this.insertPending(event.id, 'insert_http', () =>
      this.withLocalTimeout(
        () => this.client.$executeRaw`
          INSERT INTO kpi_http_event (id, environment, operation, started_at, outcome)
          VALUES (${event.id}::uuid, ${event.environment}, ${event.operation}, ${event.startedAt}::timestamptz, 'pending')`,
      ),
    );
  }

  insertDependencyPending(event: DependencyPendingEvent): Promise<void> {
    return this.insertPending(event.id, 'insert_dependency', () =>
      this.withLocalTimeout(
        () => this.client.$executeRaw`
          INSERT INTO kpi_dependency_event (id, environment, operation_id, dependency, attempt, started_at, outcome)
          VALUES (${event.id}::uuid, ${event.environment}, ${event.operationId}::uuid, ${event.dependency},
                  ${event.attempt}::integer, ${event.startedAt}::timestamptz, 'pending')`,
      ),
    );
  }

  closeDependency(event: DependencyCloseEvent): Promise<void> {
    const priorInsert = this.pendingInserts.get(event.id);
    const settled = this.track('close_dependency', async () => {
      if (priorInsert) await priorInsert;
      const updated = await this.withLocalTimeout(
        () => this.client.$executeRaw`
        UPDATE kpi_dependency_event
           SET outcome = ${event.outcome},
               finished_at = ${event.finishedAt}::timestamptz,
               duration_ms = ${event.durationMs}::double precision
         WHERE id = ${event.id}::uuid AND outcome = 'pending'`,
      );
      if (updated === 0) logger.debug('KPI_CLOSE_NOT_PENDING op=close_dependency');
    });
    return awaitWriteBounded(() => settled, 'close_dependency');
  }

  closeHttp(event: HttpCloseEvent): Promise<void> {
    const priorInsert = this.pendingInserts.get(event.id);
    const settled = this.track('close_http', async () => {
      if (priorInsert) await priorInsert;
      const updated = await this.withLocalTimeout(
        () => this.client.$executeRaw`
        UPDATE kpi_http_event
           SET operation = ${event.operation},
               outcome = ${event.outcome},
               http_status = ${event.httpStatus}::smallint,
               finished_at = ${event.finishedAt}::timestamptz,
               duration_ms = ${event.durationMs}::double precision
         WHERE id = ${event.id}::uuid AND outcome = 'pending'`,
      );
      if (updated === 0) logger.debug('KPI_CLOSE_NOT_PENDING op=close_http');
    });
    return awaitWriteBounded(() => settled, 'close_http');
  }

  async drain(timeoutMs: number = KPI_DRAIN_TIMEOUT_MS): Promise<void> {
    if (this.inFlight.size === 0) return;
    const all = Promise.all([...this.inFlight]);
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        logger.warn('KPI_DRAIN_TIMEOUT');
        resolve();
      }, timeoutMs);
      void all.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  inFlightCount(): number {
    return this.inFlight.size;
  }

  async dispose(): Promise<void> {
    await this.onDispose?.().catch(() => undefined);
  }

  /** Corre la escritura en su propia transacción (batch), precedida por el SET LOCAL del límite SQL. */
  private async withLocalTimeout(write: () => Prisma.PrismaPromise<number>): Promise<number> {
    const setLocal = this.client.$executeRawUnsafe(SET_LOCAL_STATEMENT_TIMEOUT);
    const [, affected] = await this.client.$transaction([setLocal, write()]);
    return affected;
  }

  /** INSERT pending registrado por id, para que el cierre del mismo id espere al insert. */
  private insertPending(id: string, operation: string, run: () => Promise<unknown>): Promise<void> {
    const settled = this.track(operation, run);
    this.pendingInserts.set(id, settled);
    void settled.then(() => {
      if (this.pendingInserts.get(id) === settled) this.pendingInserts.delete(id);
    });
    return awaitWriteBounded(() => settled, operation);
  }

  /** Ejecuta la query y la registra en vuelo hasta que termina; la promesa resultante nunca rechaza. */
  private track(operation: string, run: () => Promise<unknown>): Promise<void> {
    let settled: Promise<void>;
    try {
      settled = run().then(
        () => undefined,
        error => logWriteFailure(operation, error),
      );
    } catch (error) {
      logWriteFailure(operation, error);
      return Promise.resolve();
    }
    this.inFlight.add(settled);
    void settled.then(() => this.inFlight.delete(settled));
    return settled;
  }
}

export class NoopKpiEventWriter implements KpiEventWriter {
  async insertHttpPending(_event: HttpPendingEvent): Promise<void> {}
  async closeHttp(_event: HttpCloseEvent): Promise<void> {}
  async insertDependencyPending(_event: DependencyPendingEvent): Promise<void> {}
  async closeDependency(_event: DependencyCloseEvent): Promise<void> {}
  async drain(_timeoutMs?: number): Promise<void> {}
  inFlightCount(): number {
    return 0;
  }
}
