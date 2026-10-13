// NUT-85 Fix 2 — Arranque en frío: una conexión nueva lenta no debe perder la request ni demorar al negocio.
// Contrato fijado:
// - La espera acotada del negocio (KPI_WRITE_WAIT_MS = 250) no cambia: si la conexión tarda (~600 ms), la promesa
//   de insertHttpPending resuelve a los 250 ms con KPI_WRITE_WAIT_EXCEEDED y el insert termina después, en vuelo.
// - closeHttp del MISMO id se aplica después del insert (insert y luego update) ⇒ UNA fila terminal, nunca 0 filas.
// - drain espera a que terminen ambas escrituras.
// - Middleware real + PrismaKpiEventWriter real sobre ese cliente lento: respuesta de negocio ≤ 2×250 + margen y
//   al final un único evento cerrado con el status correcto.
import { Controller, Get, Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { KPI_DRAIN_TIMEOUT_MS, KPI_WRITE_WAIT_MS, PrismaKpiEventWriter } from '../events/kpi-event-writer';
import type { HttpCloseEvent, HttpPendingEvent, KpiWriterClient } from '../events/kpi-event-writer';
import { KpiModule } from '../kpi.module';
import { DB_HEALTH_PROBE, KPI_CONFIG, KPI_EVENT_WRITER } from '../kpi.tokens';

const COLD_CONNECT_MS = 600;

interface FakeRow {
  outcome: string;
  operation: string | null;
  httpStatus: number | null;
}

type Statement =
  | { kind: 'set_local' }
  | { kind: 'insert'; id: string; operation: string }
  | { kind: 'update'; id: string; operation: string; outcome: string; httpStatus: number | null };

/**
 * Base KPI falsa con estado: la primera conexión del pool tarda `coldMs` en abrir (arranque en frío) y toda
 * transacción espera a que esté lista. INSERT crea la fila pending; UPDATE sólo afecta filas pending (como el SQL real).
 */
function coldStartDb(coldMs: number) {
  const rows = new Map<string, FakeRow>();
  const applied: Array<{ kind: 'insert' | 'update'; id: string; affected: number }> = [];
  let connection: Promise<void> | undefined;

  const parse = (strings: TemplateStringsArray | string, values: unknown[]): Statement => {
    const sql = typeof strings === 'string' ? strings : strings.join('?');
    if (/^\s*SET\s+LOCAL/i.test(sql)) return { kind: 'set_local' };
    if (/INSERT\s+INTO\s+kpi_http_event/i.test(sql)) {
      return { kind: 'insert', id: String(values[0]), operation: String(values[2]) };
    }
    if (/UPDATE\s+kpi_http_event/i.test(sql)) {
      return {
        kind: 'update',
        operation: String(values[0]),
        outcome: String(values[1]),
        httpStatus: values[2] === null ? null : Number(values[2]),
        id: String(values[values.length - 1]),
      };
    }
    throw new Error(`statement no esperado: ${sql}`);
  };

  const apply = (statement: Statement): number => {
    if (statement.kind === 'set_local') return 0;
    if (statement.kind === 'insert') {
      rows.set(statement.id, { outcome: 'pending', operation: statement.operation, httpStatus: null });
      applied.push({ kind: 'insert', id: statement.id, affected: 1 });
      return 1;
    }
    const row = rows.get(statement.id);
    const affected = row && row.outcome === 'pending' ? 1 : 0;
    if (row && affected === 1) {
      row.outcome = statement.outcome;
      row.operation = statement.operation;
      row.httpStatus = statement.httpStatus;
    }
    applied.push({ kind: 'update', id: statement.id, affected });
    return affected;
  };

  const raw = (strings: TemplateStringsArray | string, ...values: unknown[]) => parse(strings, values);

  const client = {
    $executeRaw: raw,
    $executeRawUnsafe: raw,
    $transaction: async (batch: Statement[]) => {
      connection ??= new Promise<void>(resolve => setTimeout(resolve, coldMs));
      await connection;
      return batch.map(apply);
    },
  } as unknown as KpiWriterClient;

  return { client, rows, applied };
}

function captureLogs() {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };
  const spies: jest.SpyInstance[] = [];
  for (const method of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const) {
    spies.push(jest.spyOn(Logger.prototype, method).mockImplementation(record));
    spies.push(jest.spyOn(Logger, method).mockImplementation(record));
  }
  return {
    text: () => lines.join('\n'),
    restore: () => spies.forEach(spy => spy.mockRestore()),
  };
}

const ID = '3f1c2b7e-9d4a-4c1e-8f2a-0b6d5e4c3a21';
const STARTED_AT = new Date('2026-10-09T12:00:00.000Z');
const PENDING: HttpPendingEvent = { id: ID, environment: 'dev', operation: 'UNRESOLVED', startedAt: STARTED_AT };
const CLOSE: HttpCloseEvent = {
  id: ID,
  operation: 'GET /cold/ok',
  outcome: 'success',
  httpStatus: 200,
  finishedAt: new Date(STARTED_AT.getTime() + 12),
  durationMs: 12,
};

describe('PrismaKpiEventWriter — arranque en frío (Fix 2)', () => {
  let logs: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    jest.useFakeTimers();
    logs = captureLogs();
  });

  afterEach(() => {
    logs.restore();
    jest.useRealTimers();
  });

  it('insert pending lento: la espera acotada resuelve a los 250 ms, el insert termina en vuelo y el cierre del mismo id se aplica después ⇒ UNA fila terminal', async () => {
    const db = coldStartDb(COLD_CONNECT_MS);
    const writer = new PrismaKpiEventWriter(db.client);

    let insertResolved = false;
    const insert = writer.insertHttpPending(PENDING).then(() => {
      insertResolved = true;
    });
    await jest.advanceTimersByTimeAsync(KPI_WRITE_WAIT_MS - 1);
    expect(insertResolved).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await insert;
    expect(insertResolved).toBe(true);
    expect(logs.text()).toContain('KPI_WRITE_WAIT_EXCEEDED');
    // La respuesta de negocio ya pudo salir y el insert todavía no se aplicó: sigue en vuelo.
    expect(db.applied).toEqual([]);
    expect(writer.inFlightCount()).toBeGreaterThan(0);

    // El negocio respondió: llega el cierre del mismo id mientras la conexión todavía se abre.
    let closeResolved = false;
    const close = writer.closeHttp(CLOSE).then(() => {
      closeResolved = true;
    });
    let drained = false;
    const drain = writer.drain(KPI_DRAIN_TIMEOUT_MS).then(() => {
      drained = true;
    });

    await jest.advanceTimersByTimeAsync(KPI_WRITE_WAIT_MS);
    await close;
    expect(closeResolved).toBe(true);
    expect(drained).toBe(false);
    expect(db.applied).toEqual([]);

    await jest.advanceTimersByTimeAsync(COLD_CONNECT_MS);
    await drain;
    expect(drained).toBe(true);
    expect(writer.inFlightCount()).toBe(0);

    // Orden: insert y luego update del MISMO id, y el update afectó la fila.
    expect(db.applied).toEqual([
      { kind: 'insert', id: ID, affected: 1 },
      { kind: 'update', id: ID, affected: 1 },
    ]);
    expect(db.rows.size).toBe(1);
    expect(db.rows.get(ID)).toEqual({ outcome: 'success', operation: 'GET /cold/ok', httpStatus: 200 });
    expect(logs.text()).not.toContain('KPI_CLOSE_NOT_PENDING');
    expect(logs.text()).not.toContain('KPI_WRITE_FAILED');
  });
});

// ==============================================================================================
@Controller('cold')
class ColdStartTestController {
  @Get('ok')
  ok() {
    return { ok: true };
  }
}

describe('KpiHttpMiddleware + PrismaKpiEventWriter real — arranque en frío (Fix 2)', () => {
  jest.setTimeout(15_000);

  it('conexión nueva lenta (~600 ms): respuesta de negocio dentro del límite acotado y un único evento cerrado con el status correcto', async () => {
    const logs = captureLogs();
    const db = coldStartDb(COLD_CONNECT_MS);
    const writer = new PrismaKpiEventWriter(db.client);
    const moduleRef = await Test.createTestingModule({ imports: [KpiModule], controllers: [ColdStartTestController] })
      .overrideProvider(KPI_CONFIG)
      .useValue({ enabled: true, environment: 'dev', disabledReason: null })
      .overrideProvider(KPI_EVENT_WRITER)
      .useValue(writer)
      .overrideProvider(DB_HEALTH_PROBE)
      .useValue({ ping: async () => undefined })
      .compile();
    const app: INestApplication = moduleRef.createNestApplication({ logger: false });
    try {
      await app.init();
      await app.listen(0, '127.0.0.1');
      const { port } = app.getHttpServer().address() as AddressInfo;

      const began = Date.now();
      const response = await fetch(`http://127.0.0.1:${port}/cold/ok`);
      const body = await response.json();
      const elapsed = Date.now() - began;

      expect(response.status).toBe(200);
      expect(body).toEqual({ ok: true });
      expect(elapsed).toBeLessThan(2 * KPI_WRITE_WAIT_MS + 400);

      // Las escrituras terminan en vuelo; drain las espera.
      await writer.drain(KPI_DRAIN_TIMEOUT_MS);
      expect(writer.inFlightCount()).toBe(0);

      expect(db.rows.size).toBe(1);
      const [[id, row]] = [...db.rows.entries()];
      expect(row).toEqual({ outcome: 'success', operation: 'GET /cold/ok', httpStatus: 200 });
      expect(db.applied).toEqual([
        { kind: 'insert', id, affected: 1 },
        { kind: 'update', id, affected: 1 },
      ]);
    } finally {
      await app.close();
      logs.restore();
    }
  });
});
