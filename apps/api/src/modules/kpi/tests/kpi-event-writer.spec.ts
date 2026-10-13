// NUT-85 T3 — Escritor de eventos con cliente Prisma falso y fake timers (B3, B6; design D3, D5).
// Contrato fijado:
// - PrismaKpiEventWriter(client) usa client.$executeRaw (tagged template, parametrizado).
// - insertHttpPending / closeHttp nunca rechazan y resuelven en ≤ KPI_WRITE_WAIT_MS (250 ms).
// - Fallos ⇒ log con código técnico (KPI_WRITE_TIMEOUT si SQLSTATE 57014, KPI_WRITE_FAILED, KPI_WRITE_WAIT_EXCEEDED)
//   + SQLSTATE; nunca el mensaje del error ni la URL.
// - Registro en vuelo: inFlightCount() cuenta queries no terminadas; drain(ms) espera acotado a que se vacíe.
// - NoopKpiEventWriter no toca nada.
// - createKpiPrismaClient(url, overrides) arma un Pool propio: max 2, statement_timeout 100, query_timeout ≤ 150,
//   connectionTimeoutMillis ≤ 150, sin conectar al construirse.
import { Logger } from '@nestjs/common';
import { createKpiPrismaClient } from '../db/kpi-prisma';
import {
  KPI_DRAIN_TIMEOUT_MS,
  KPI_SQL_STATEMENT_TIMEOUT_MS,
  KPI_WRITE_WAIT_MS,
  NoopKpiEventWriter,
  PrismaKpiEventWriter,
} from '../events/kpi-event-writer';
import type { HttpCloseEvent, HttpPendingEvent, KpiWriterClient } from '../events/kpi-event-writer';

const ID = '3f1c2b7e-9d4a-4c1e-8f2a-0b6d5e4c3a21';
const STARTED_AT = new Date('2026-10-09T12:00:00.000Z');

const PENDING: HttpPendingEvent = {
  id: ID,
  environment: 'dev',
  operation: 'UNRESOLVED',
  startedAt: STARTED_AT,
};

const CLOSE: HttpCloseEvent = {
  id: ID,
  operation: 'GET /meal-plans/:planId',
  outcome: 'success',
  httpStatus: 200,
  finishedAt: new Date(STARTED_AT.getTime() + 12.5),
  durationMs: 12.5,
};

interface RecordedQuery {
  sql: string;
  values: unknown[];
}

function fakeClient(behavior: () => Promise<number>) {
  const queries: RecordedQuery[] = [];
  const $executeRaw = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ sql: strings.join('?'), values });
    return behavior();
  });
  return { client: { $executeRaw } as unknown as KpiWriterClient, queries, $executeRaw };
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
  for (const method of ['log', 'error', 'warn', 'info', 'debug'] as const) {
    spies.push(jest.spyOn(console, method).mockImplementation(record));
  }
  return {
    text: () => lines.join('\n'),
    restore: () => spies.forEach(spy => spy.mockRestore()),
  };
}

function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('PrismaKpiEventWriter (unit)', () => {
  let logs: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    jest.useFakeTimers();
    logs = captureLogs();
  });

  afterEach(() => {
    logs.restore();
    jest.useRealTimers();
  });

  it('constantes de límites del diseño', () => {
    expect(KPI_WRITE_WAIT_MS).toBe(250);
    expect(KPI_SQL_STATEMENT_TIMEOUT_MS).toBe(100);
    expect(KPI_DRAIN_TIMEOUT_MS).toBe(1000);
  });

  it('insertHttpPending hace un INSERT parametrizado en kpi_http_event con outcome pending', async () => {
    const { client, queries } = fakeClient(async () => 1);
    const writer = new PrismaKpiEventWriter(client);

    await writer.insertHttpPending(PENDING);

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/INSERT\s+INTO\s+"?kpi_http_event"?/i);
    expect(queries[0].values).toEqual(expect.arrayContaining([ID, 'dev', 'UNRESOLVED']));
    expect(`${queries[0].sql} ${JSON.stringify(queries[0].values)}`).toContain('pending');
  });

  it('closeHttp es sólo un UPDATE condicional del mismo id con outcome = pending (B3: nunca INSERT)', async () => {
    const { client, queries } = fakeClient(async () => 1);
    const writer = new PrismaKpiEventWriter(client);

    await writer.closeHttp(CLOSE);
    await writer.closeHttp({ ...CLOSE, outcome: 'server_error', httpStatus: 500 });

    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.sql).toMatch(/UPDATE\s+"?kpi_http_event"?/i);
      expect(query.sql).not.toMatch(/INSERT/i);
      expect(query.sql).toMatch(/WHERE[\s\S]*id[\s\S]*outcome/i);
      expect(`${query.sql} ${JSON.stringify(query.values)}`).toContain('pending');
      expect(query.values).toContain(ID);
    }
  });

  it('cierre que afecta 0 filas (ya cerrado) no lanza ni reintenta', async () => {
    const { client, queries } = fakeClient(async () => 0);
    const writer = new PrismaKpiEventWriter(client);

    await expect(writer.closeHttp(CLOSE)).resolves.toBeUndefined();
    expect(queries).toHaveLength(1);
  });

  it('nunca rechaza ante error del cliente y loguea KPI_WRITE_FAILED con SQLSTATE, sin mensaje', async () => {
    const { client } = fakeClient(() =>
      Promise.reject(pgError('08006', 'connection failure postgresql://user:hunter2@db.neon.tech/x')),
    );
    const writer = new PrismaKpiEventWriter(client);

    await expect(writer.insertHttpPending(PENDING)).resolves.toBeUndefined();
    await expect(writer.closeHttp(CLOSE)).resolves.toBeUndefined();

    expect(logs.text()).toContain('KPI_WRITE_FAILED');
    expect(logs.text()).toContain('08006');
    expect(logs.text()).not.toMatch(/hunter2|neon\.tech|postgresql:\/\/|connection failure/);
  });

  it('SQLSTATE 57014 (statement_timeout) ⇒ KPI_WRITE_TIMEOUT', async () => {
    const { client } = fakeClient(() =>
      Promise.reject(pgError('57014', 'canceling statement due to statement timeout')),
    );
    const writer = new PrismaKpiEventWriter(client);

    await expect(writer.insertHttpPending(PENDING)).resolves.toBeUndefined();

    expect(logs.text()).toContain('KPI_WRITE_TIMEOUT');
    expect(logs.text()).not.toContain('canceling statement');
  });

  it('error sin SQLSTATE (no Postgres) también se captura como KPI_WRITE_FAILED', async () => {
    const { client } = fakeClient(() => Promise.reject(new TypeError('boom secret-token')));
    const writer = new PrismaKpiEventWriter(client);

    await expect(writer.closeHttp(CLOSE)).resolves.toBeUndefined();
    expect(logs.text()).toContain('KPI_WRITE_FAILED');
    expect(logs.text()).not.toContain('secret-token');
  });

  it('resuelve en ≤ 250 ms aunque la query no termine, loguea KPI_WRITE_WAIT_EXCEEDED', async () => {
    const { client } = fakeClient(() => new Promise<number>(() => undefined));
    const writer = new PrismaKpiEventWriter(client);
    let settled = false;

    const write = writer.insertHttpPending(PENDING).then(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(KPI_WRITE_WAIT_MS - 1);
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await write;
    expect(settled).toBe(true);
    expect(logs.text()).toContain('KPI_WRITE_WAIT_EXCEEDED');
  });

  it('una escritura rápida limpia su temporizador de espera', async () => {
    const { client } = fakeClient(async () => 1);
    const writer = new PrismaKpiEventWriter(client);

    await writer.insertHttpPending(PENDING);
    await writer.closeHttp(CLOSE);

    expect(jest.getTimerCount()).toBe(0);
    expect(writer.inFlightCount()).toBe(0);
  });

  it('la query que excede la espera queda en vuelo y drain espera a que termine', async () => {
    let finish: (rows: number) => void = () => undefined;
    const { client } = fakeClient(
      () =>
        new Promise<number>(resolve => {
          finish = resolve;
        }),
    );
    const writer = new PrismaKpiEventWriter(client);

    const write = writer.insertHttpPending(PENDING);
    await jest.advanceTimersByTimeAsync(KPI_WRITE_WAIT_MS);
    await write;
    expect(writer.inFlightCount()).toBe(1);

    let drained = false;
    const drain = writer.drain(KPI_DRAIN_TIMEOUT_MS).then(() => {
      drained = true;
    });
    await jest.advanceTimersByTimeAsync(100);
    expect(drained).toBe(false);

    finish(1);
    await jest.advanceTimersByTimeAsync(0);
    await drain;
    expect(drained).toBe(true);
    expect(writer.inFlightCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('drain es acotado: con una query colgada resuelve a los 1000 ms sin rechazar', async () => {
    const { client } = fakeClient(() => new Promise<number>(() => undefined));
    const writer = new PrismaKpiEventWriter(client);

    const write = writer.insertHttpPending(PENDING);
    await jest.advanceTimersByTimeAsync(KPI_WRITE_WAIT_MS);
    await write;

    let drained = false;
    const drain = writer.drain(KPI_DRAIN_TIMEOUT_MS).then(() => {
      drained = true;
    });
    await jest.advanceTimersByTimeAsync(KPI_DRAIN_TIMEOUT_MS - 1);
    expect(drained).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await drain;
    expect(drained).toBe(true);
  });

  it('drain sin escrituras en vuelo resuelve de inmediato', async () => {
    const { client } = fakeClient(async () => 1);
    const writer = new PrismaKpiEventWriter(client);

    await expect(writer.drain(KPI_DRAIN_TIMEOUT_MS)).resolves.toBeUndefined();
  });
});

describe('NoopKpiEventWriter', () => {
  it('no hace nada, nunca rechaza y no deja nada en vuelo', async () => {
    const writer = new NoopKpiEventWriter();

    await expect(writer.insertHttpPending(PENDING)).resolves.toBeUndefined();
    await expect(writer.closeHttp(CLOSE)).resolves.toBeUndefined();
    await expect(writer.drain(KPI_DRAIN_TIMEOUT_MS)).resolves.toBeUndefined();
    expect(writer.inFlightCount()).toBe(0);
  });
});

describe('createKpiPrismaClient (pool propio, D3)', () => {
  it('pool dedicado chico con statement_timeout 100 ms y timeouts de cliente ≤ 150 ms, sin conectar', async () => {
    const handle = createKpiPrismaClient('postgresql://kpi:kpi@127.0.0.1:1/kpi', {
      options: '-c search_path=kpi_x,public',
    });
    try {
      const options = (handle.pool as unknown as { options: Record<string, unknown> }).options;

      expect(options.max).toBe(2);
      expect(options.statement_timeout).toBe(100);
      expect(options.query_timeout).toBeLessThanOrEqual(150);
      expect(options.connectionTimeoutMillis).toBeLessThanOrEqual(150);
      expect(options.connectionTimeoutMillis).toBeGreaterThan(0);
      expect(options.options).toBe('-c search_path=kpi_x,public');
      expect(handle.pool.totalCount).toBe(0);
      expect(typeof handle.prisma.$executeRaw).toBe('function');
    } finally {
      await handle.pool.end();
    }
  });
});
