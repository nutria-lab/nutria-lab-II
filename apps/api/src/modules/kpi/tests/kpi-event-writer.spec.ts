// NUT-85 T3 — Escritor de eventos con cliente Prisma falso y fake timers (B3, B6; design D3, D5).
// Contrato fijado:
// - PrismaKpiEventWriter(client) usa client.$executeRaw (tagged template, parametrizado).
// - insertHttpPending / closeHttp nunca rechazan y resuelven en ≤ KPI_WRITE_WAIT_MS (250 ms).
// - Fallos ⇒ log con código técnico (KPI_WRITE_TIMEOUT si SQLSTATE 57014, KPI_WRITE_FAILED, KPI_WRITE_WAIT_EXCEEDED)
//   + SQLSTATE; nunca el mensaje del error ni la URL.
// - Registro en vuelo: inFlightCount() cuenta queries no terminadas; drain(ms) espera acotado a que se vacíe.
// - NoopKpiEventWriter no toca nada.
// - Cada escritura (insert pending y cierre, HTTP y dependencia) corre en una transacción Prisma (batch o interactiva)
//   que aplica `SET LOCAL statement_timeout = '100ms'` (o set_config('statement_timeout','100ms', true)) ANTES de la
//   escritura y en la MISMA transacción (corrección post-review: nada de parámetros de arranque, PgBouncer de Neon).
// - createKpiPrismaClient(url, overrides) arma un Pool propio: max 2, SIN statement_timeout de arranque,
//   query_timeout = 150, connectionTimeoutMillis = KPI_CONNECT_TIMEOUT_MS (1500, Fix 2: arranque en frío), sin conectar
//   al construirse. La espera acotada del negocio sigue en KPI_WRITE_WAIT_MS (250) y el SET LOCAL en 100 ms.
import { Logger } from '@nestjs/common';
import { KPI_CONNECT_TIMEOUT_MS, createKpiPrismaClient } from '../db/kpi-prisma';
import {
  KPI_DRAIN_TIMEOUT_MS,
  KPI_SQL_STATEMENT_TIMEOUT_MS,
  KPI_WRITE_WAIT_MS,
  NoopKpiEventWriter,
  PrismaKpiEventWriter,
} from '../events/kpi-event-writer';
import type {
  DependencyCloseEvent,
  DependencyPendingEvent,
  HttpCloseEvent,
  HttpPendingEvent,
  KpiWriterClient,
} from '../events/kpi-event-writer';

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

const DEP_ID = '7a2d4c1e-5b3f-4e8a-9c0d-1f2e3d4c5b6a';
const OPERATION_ID = '0c9b8a7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';

const DEP_PENDING: DependencyPendingEvent = {
  id: DEP_ID,
  environment: 'dev',
  operationId: OPERATION_ID,
  dependency: 'gemini',
  attempt: 1,
  startedAt: STARTED_AT,
};

const DEP_CLOSE: DependencyCloseEvent = {
  id: DEP_ID,
  outcome: 'success',
  finishedAt: new Date(STARTED_AT.getTime() + 40),
  durationMs: 40,
};

interface RecordedQuery {
  sql: string;
  values: unknown[];
  /** Transacción en la que corrió la query; null si fue fuera de una transacción. */
  tx: number | null;
  /** true si es `SET LOCAL statement_timeout = '100ms'` o set_config('statement_timeout', '100ms', true). */
  isTimeoutSetting: boolean;
}

const QUERY_TAG = Symbol('recordedQuery');

function renderSql(strings: readonly string[] | string, values: unknown[]): string {
  if (typeof strings === 'string') return `${strings} ${values.map(value => `'${String(value)}'`).join(' ')}`;
  return strings.reduce(
    (acc, part, index) => acc + part + (index < values.length ? `'${String(values[index])}'` : ''),
    '',
  );
}

const SET_LOCAL_RE = /SET\s+LOCAL\s+statement_timeout\s*(=|TO)\s*'?100ms'?/i;
const SET_CONFIG_RE = /set_config\(\s*'statement_timeout'\s*,\s*'100ms'\s*,\s*'?true'?\s*\)/i;

function isTimeoutSettingSql(rendered: string): boolean {
  return SET_LOCAL_RE.test(rendered) || SET_CONFIG_RE.test(rendered);
}

/**
 * Cliente Prisma falso: $executeRaw / $executeRawUnsafe / $queryRaw / $queryRawUnsafe y $transaction en forma
 * batch (array) o interactiva (callback). `behavior` aplica sólo a las escrituras; el SET LOCAL resuelve 0.
 */
function fakeClient(behavior: () => Promise<number>) {
  const queries: RecordedQuery[] = [];
  let txSeq = 0;

  const makeRaw = (txId: number | null) =>
    jest.fn((strings: TemplateStringsArray | string, ...values: unknown[]) => {
      const raw = strings as readonly string[] | string;
      const query: RecordedQuery = {
        sql: typeof raw === 'string' ? raw : raw.join('?'),
        values,
        tx: txId,
        isTimeoutSetting: isTimeoutSettingSql(renderSql(raw, values)),
      };
      queries.push(query);
      const result = query.isTimeoutSetting ? Promise.resolve(0) : behavior();
      return Object.assign(result, { [QUERY_TAG]: query });
    });

  const rawMethods = (txId: number | null) => ({
    $executeRaw: makeRaw(txId),
    $executeRawUnsafe: makeRaw(txId),
    $queryRaw: makeRaw(txId),
    $queryRawUnsafe: makeRaw(txId),
  });

  const top = rawMethods(null);
  const $transaction = jest.fn((arg: unknown) => {
    const txId = ++txSeq;
    if (typeof arg === 'function') {
      return Promise.resolve().then(() => (arg as (tx: unknown) => Promise<unknown>)(rawMethods(txId)));
    }
    const batch = arg as Array<Promise<unknown> & { [QUERY_TAG]?: RecordedQuery }>;
    for (const item of batch) {
      if (item[QUERY_TAG]) item[QUERY_TAG].tx = txId;
    }
    return Promise.all(batch);
  });

  return {
    client: { ...top, $transaction } as unknown as KpiWriterClient,
    queries,
    /** Sólo las escrituras (sin el SET LOCAL del límite). */
    writes: () => queries.filter(query => !query.isTimeoutSetting),
    $executeRaw: top.$executeRaw,
    $transaction,
  };
}

/** La escritura corrió en una transacción y, antes, en esa MISMA transacción se aplicó el SET LOCAL de 100 ms. */
function expectBoundedByLocalTimeout(queries: RecordedQuery[], write: RecordedQuery): void {
  expect(write.tx).not.toBeNull();
  const writeIndex = queries.indexOf(write);
  const setting = queries.find(
    (query, index) => query.isTimeoutSetting && query.tx === write.tx && index < writeIndex,
  );
  expect(setting).toBeDefined();
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
    const { client, writes } = fakeClient(async () => 1);
    const writer = new PrismaKpiEventWriter(client);

    await writer.insertHttpPending(PENDING);

    const queries = writes();
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/INSERT\s+INTO\s+"?kpi_http_event"?/i);
    expect(queries[0].values).toEqual(expect.arrayContaining([ID, 'dev', 'UNRESOLVED']));
    expect(`${queries[0].sql} ${JSON.stringify(queries[0].values)}`).toContain('pending');
  });

  it('closeHttp es sólo un UPDATE condicional del mismo id con outcome = pending (B3: nunca INSERT)', async () => {
    const { client, writes } = fakeClient(async () => 1);
    const writer = new PrismaKpiEventWriter(client);

    await writer.closeHttp(CLOSE);
    await writer.closeHttp({ ...CLOSE, outcome: 'server_error', httpStatus: 500 });

    const queries = writes();
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
    const { client, writes } = fakeClient(async () => 0);
    const writer = new PrismaKpiEventWriter(client);

    await expect(writer.closeHttp(CLOSE)).resolves.toBeUndefined();
    expect(writes()).toHaveLength(1);
  });

  it.each([
    ['insertHttpPending', /INSERT\s+INTO\s+"?kpi_http_event"?/i, (w: PrismaKpiEventWriter) => w.insertHttpPending(PENDING)],
    ['closeHttp', /UPDATE\s+"?kpi_http_event"?/i, (w: PrismaKpiEventWriter) => w.closeHttp(CLOSE)],
    [
      'insertDependencyPending',
      /INSERT\s+INTO\s+"?kpi_dependency_event"?/i,
      (w: PrismaKpiEventWriter) => w.insertDependencyPending(DEP_PENDING),
    ],
    ['closeDependency', /UPDATE\s+"?kpi_dependency_event"?/i, (w: PrismaKpiEventWriter) => w.closeDependency(DEP_CLOSE)],
  ])(
    '%s aplica SET LOCAL statement_timeout = 100ms en la MISMA transacción, antes de la escritura',
    async (_name, writeRe, run) => {
      const { client, queries, writes } = fakeClient(async () => 1);
      const writer = new PrismaKpiEventWriter(client);

      await run(writer);

      const written = writes();
      expect(written).toHaveLength(1);
      expect(written[0].sql).toMatch(writeRe);
      expectBoundedByLocalTimeout(queries, written[0]);
      // Nunca un SET de sesión (sin LOCAL), que quedaría pegado a la conexión del pool.
      for (const query of queries) {
        expect(renderSql(query.sql, query.values)).not.toMatch(/SET\s+(SESSION\s+)?statement_timeout/i);
      }
    },
  );

  it('cada escritura abre su propia transacción con su SET LOCAL (el límite no se hereda entre escrituras)', async () => {
    const { client, queries, writes } = fakeClient(async () => 1);
    const writer = new PrismaKpiEventWriter(client);

    await writer.insertHttpPending(PENDING);
    await writer.closeHttp(CLOSE);

    const written = writes();
    expect(written).toHaveLength(2);
    expect(written[0].tx).not.toBe(written[1].tx);
    for (const write of written) expectBoundedByLocalTimeout(queries, write);
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

  describe('fallos sin SQLSTATE: código técnico estable, nunca el mensaje (D32)', () => {
    const cases: Array<[string, () => Error, RegExp, string]> = [
      [
        'query_timeout del cliente pg (Error("Query read timeout"), sin code)',
        () => new Error('Query read timeout'),
        /^KPI_WRITE_TIMEOUT op=insert_dependency sqlstate=none code=CLIENT_QUERY_TIMEOUT$/m,
        'Query read timeout',
      ],
      [
        'connect timeout del pool pg',
        () => new Error('timeout exceeded when trying to connect'),
        /^KPI_WRITE_FAILED op=insert_dependency sqlstate=none code=CLIENT_CONNECT_TIMEOUT$/m,
        'timeout exceeded',
      ],
      [
        'error Prisma P2028 sin SQLSTATE',
        () =>
          Object.assign(new Error('Transaction API error: secret-tx-detail'), {
            code: 'P2028',
            clientVersion: '7.0.0',
          }),
        /^KPI_WRITE_FAILED op=insert_dependency sqlstate=none code=P2028$/m,
        'secret-tx-detail',
      ],
    ];

    it.each(cases)('%s', async (_name, makeError, expected, secret) => {
      const { client } = fakeClient(() => Promise.reject(makeError()));
      const writer = new PrismaKpiEventWriter(client);

      await expect(writer.insertDependencyPending(DEP_PENDING)).resolves.toBeUndefined();

      expect(logs.text()).toMatch(expected);
      expect(logs.text()).not.toContain(secret);
    });

    it('P2010 con driverAdapterError.cause.originalCode 23505 ⇒ sqlstate=23505 y sin code=', async () => {
      const error = Object.assign(new Error('Raw query failed: duplicate key value violates unique constraint'), {
        code: 'P2010',
        clientVersion: '7.0.0',
        meta: {
          driverAdapterError: Object.assign(new Error('UniqueConstraintViolation'), {
            cause: {
              kind: 'UniqueConstraintViolation',
              originalCode: '23505',
              originalMessage: 'duplicate key value violates unique constraint secret-idx',
            },
          }),
        },
      });
      const { client } = fakeClient(() => Promise.reject(error));
      const writer = new PrismaKpiEventWriter(client);

      await expect(writer.insertDependencyPending(DEP_PENDING)).resolves.toBeUndefined();

      expect(logs.text()).toMatch(/^KPI_WRITE_FAILED op=insert_dependency sqlstate=23505$/m);
      expect(logs.text()).not.toContain('code=');
      expect(logs.text()).not.toMatch(/duplicate key|secret-idx|Raw query failed/);
    });
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
  it('KPI_CONNECT_TIMEOUT_MS = 1500 (Fix 2): separado del timeout de consulta', () => {
    expect(KPI_CONNECT_TIMEOUT_MS).toBe(1500);
    // La protección del negocio no cambia: la espera acotada y el límite SQL siguen iguales.
    expect(KPI_WRITE_WAIT_MS).toBe(250);
    expect(KPI_SQL_STATEMENT_TIMEOUT_MS).toBe(100);
  });

  it('pool dedicado chico SIN statement_timeout de arranque (PgBouncer), query_timeout 150 y connect 1500, sin conectar', async () => {
    const handle = createKpiPrismaClient('postgresql://kpi:kpi@127.0.0.1:1/kpi', {
      options: '-c search_path=kpi_x,public',
    });
    try {
      const options = (handle.pool as unknown as { options: Record<string, unknown> }).options;

      expect(options.max).toBe(2);
      // Sin parámetros de startup: el límite SQL va como SET LOCAL dentro de cada escritura.
      expect(options.statement_timeout).toBeUndefined();
      expect(String(options.options ?? '')).not.toMatch(/statement_timeout/i);
      expect(String(options.connectionString ?? '')).not.toMatch(/statement_timeout/i);
      expect(options.query_timeout).toBe(150);
      // Fix 2: una conexión nueva (arranque en frío Vercel+Neon) suele tardar más de 150 ms.
      expect(options.connectionTimeoutMillis).toBe(KPI_CONNECT_TIMEOUT_MS);
      expect(options.connectionTimeoutMillis).toBe(1500);
      expect(options.options).toBe('-c search_path=kpi_x,public');
      expect(handle.pool.totalCount).toBe(0);
      expect(typeof handle.prisma.$executeRaw).toBe('function');
    } finally {
      await handle.pool.end();
    }
  });
});
