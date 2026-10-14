import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { createKpiPrismaClient } from '../db/kpi-prisma';
import type { KpiPrismaHandle } from '../db/kpi-prisma';
import { KPI_WRITE_WAIT_MS, PrismaKpiEventWriter } from '../events/kpi-event-writer';
import {
  DisposableSchema,
  applyMigrations,
  createDisposableSchema,
  describeIfKpiDb,
  kpiTestDatabaseUrl,
} from './kpi-test-db.fixture';
import { createWideTimeoutKpiPrismaClient } from './kpi-writer-client.fixture';

jest.setTimeout(60_000);

interface HttpRow {
  id: string;
  environment: string;
  operation: string;
  outcome: string;
  http_status: number | null;
  started_at: Date;
  finished_at: Date | null;
  duration_ms: number | null;
}

describeIfKpiDb('PrismaKpiEventWriter (integración Postgres)', () => {
  let db: DisposableSchema;
  let handle: KpiPrismaHandle;
  let writer: PrismaKpiEventWriter;
  const logLines: string[] = [];
  let spies: jest.SpyInstance[] = [];

  beforeAll(async () => {
    db = await createDisposableSchema();
    await applyMigrations(db.client);
    handle = createKpiPrismaClient(kpiTestDatabaseUrl() as string, {
      options: db.poolConfig().options,
    });
    writer = new PrismaKpiEventWriter(handle.prisma);
  });

  afterAll(async () => {
    await writer?.drain(1000);
    await handle?.prisma.$disconnect().catch(() => undefined);
    await handle?.pool.end().catch(() => undefined);
    await db?.drop();
  });

  beforeEach(() => {
    logLines.length = 0;
    const record = (...args: unknown[]) => {
      logLines.push(args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    };
    spies = [];
    for (const method of ['log', 'error', 'warn', 'debug', 'verbose'] as const) {
      spies.push(jest.spyOn(Logger.prototype, method).mockImplementation(record));
      spies.push(jest.spyOn(Logger, method).mockImplementation(record));
    }
    for (const method of ['log', 'error', 'warn', 'info'] as const) {
      spies.push(jest.spyOn(console, method).mockImplementation(record));
    }
  });

  afterEach(() => {
    spies.forEach(spy => spy.mockRestore());
  });

  async function rowsFor(id: string): Promise<HttpRow[]> {
    const result = await db.client.query<HttpRow>(
      `SELECT id, environment, operation, outcome, http_status, started_at, finished_at, duration_ms
         FROM kpi_http_event WHERE id = $1`,
      [id],
    );
    return result.rows;
  }

  it('el pool KPI NO fija statement_timeout como parámetro de sesión/arranque (compatible con PgBouncer)', async () => {
    const result = await handle.pool.query<{ statement_timeout: string }>('SHOW statement_timeout');
    expect(result.rows[0].statement_timeout).not.toBe('100ms');
  });

  it('el SET LOCAL de una escritura no queda pegado a la conexión del pool', async () => {
    await writer.insertHttpPending({ id: randomUUID(), environment: 'dev', operation: 'UNRESOLVED', startedAt: new Date() });
    // max 2: con dos clientes simultáneos se inspeccionan todas las conexiones del pool.
    const clients = await Promise.all([handle.pool.connect(), handle.pool.connect()]);
    try {
      for (const client of clients) {
        const result = await client.query<{ statement_timeout: string }>('SHOW statement_timeout');
        expect(result.rows[0].statement_timeout).not.toBe('100ms');
      }
    } finally {
      clients.forEach(client => client.release());
    }
  });

  it('B1: pending + close actualizan la misma fila (una sola fila, mismo id, duration ≥ 0)', async () => {
    const id = randomUUID();
    const startedAt = new Date();

    await writer.insertHttpPending({ id, environment: 'dev', operation: 'UNRESOLVED', startedAt });

    const pending = await rowsFor(id);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      outcome: 'pending',
      operation: 'UNRESOLVED',
      http_status: null,
      finished_at: null,
      duration_ms: null,
    });

    await writer.closeHttp({
      id,
      operation: 'GET /meal-plans/:planId',
      outcome: 'success',
      httpStatus: 200,
      durationMs: 7.25,
      finishedAt: new Date(startedAt.getTime() + 7.25),
    });

    const closed = await rowsFor(id);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      id,
      environment: 'dev',
      operation: 'GET /meal-plans/:planId',
      outcome: 'success',
      http_status: 200,
    });
    expect(closed[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect((closed[0].finished_at as Date).getTime()).toBeGreaterThanOrEqual(closed[0].started_at.getTime());
    expect(writer.inFlightCount()).toBe(0);
  });

  it('B3: un segundo cierre afecta 0 filas y no cambia outcome/finished_at/http_status', async () => {
    const id = randomUUID();
    const startedAt = new Date();
    await writer.insertHttpPending({ id, environment: 'qa', operation: 'UNRESOLVED', startedAt });
    await writer.closeHttp({
      id,
      operation: 'POST /meal-plans/:planId/regenerate',
      outcome: 'network_error',
      httpStatus: null,
      durationMs: 30,
      finishedAt: new Date(startedAt.getTime() + 30),
    });
    const [first] = await rowsFor(id);

    await writer.closeHttp({
      id,
      operation: 'POST /meal-plans/:planId/regenerate',
      outcome: 'success',
      httpStatus: 200,
      durationMs: 900,
      finishedAt: new Date(startedAt.getTime() + 900),
    });

    const rows = await rowsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('network_error');
    expect(rows[0].http_status).toBeNull();
    expect(rows[0].finished_at).toEqual(first.finished_at);
    expect(rows[0].duration_ms).toBe(first.duration_ms);
  });

  it('B3: cerrar un id sin pending no inventa una fila', async () => {
    const id = randomUUID();
    await writer.closeHttp({
      id,
      operation: 'GET /recipes',
      outcome: 'success',
      httpStatus: 200,
      durationMs: 1,
      finishedAt: new Date(),
    });
    expect(await rowsFor(id)).toHaveLength(0);
  });

  it('B6: con la tabla bloqueada por otra conexión ⇒ KPI_WRITE_TIMEOUT y espera total acotada', async () => {
    // Conexión del pool KPI ya caliente (el primer connect no cuenta para el límite SQL).
    await writer.insertHttpPending({ id: randomUUID(), environment: 'dev', operation: 'UNRESOLVED', startedAt: new Date() });

    const locker = await db.createPool({ max: 1 }).connect();
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE kpi_http_event IN ACCESS EXCLUSIVE MODE');
    const id = randomUUID();
    try {
      const began = Date.now();
      await expect(
        writer.insertHttpPending({ id, environment: 'dev', operation: 'UNRESOLVED', startedAt: new Date() }),
      ).resolves.toBeUndefined();
      const elapsed = Date.now() - began;

      // Diseño: ≤ 250 ms; margen chico por jitter del runner.
      expect(elapsed).toBeLessThanOrEqual(KPI_WRITE_WAIT_MS + 50);
      await writer.drain(1000);
      expect(logLines.join('\n')).toContain('KPI_WRITE_TIMEOUT');
      expect(logLines.join('\n')).not.toMatch(/postgresql:\/\/|kpitest:kpitest|canceling statement/);
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
    }
    expect(await rowsFor(id)).toHaveLength(0);
  });

  it('B6: el cierre (UPDATE) con la tabla bloqueada también da KPI_WRITE_TIMEOUT (SET LOCAL 57014) acotado', async () => {
    // Cliente con query_timeout amplio: bajo carga el temporizador de 150 ms del cliente puede ganarle al 57014 de Postgres.
    const wide = createWideTimeoutKpiPrismaClient(db);
    const writer = new PrismaKpiEventWriter(wide.prisma);
    const id = randomUUID();
    const startedAt = new Date();
    await writer.insertHttpPending({ id, environment: 'dev', operation: 'UNRESOLVED', startedAt });
    await writer.drain(1000);

    const locker = await db.createPool({ max: 1 }).connect();
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE kpi_http_event IN ACCESS EXCLUSIVE MODE');
    try {
      const began = Date.now();
      await expect(
        writer.closeHttp({
          id,
          operation: 'GET /recipes',
          outcome: 'success',
          httpStatus: 200,
          durationMs: 3,
          finishedAt: new Date(startedAt.getTime() + 3),
        }),
      ).resolves.toBeUndefined();
      expect(Date.now() - began).toBeLessThanOrEqual(KPI_WRITE_WAIT_MS + 50);
      await writer.drain(1000);
      expect(logLines.join('\n')).toContain('KPI_WRITE_TIMEOUT');
      expect(logLines.join('\n')).toMatch(/KPI_WRITE_TIMEOUT op=close_http sqlstate=57014$/m);
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
    }
    await writer.drain(1000);
    await wide.prisma.$disconnect().catch(() => undefined);
    await wide.pool.end().catch(() => undefined);
    const [row] = await rowsFor(id);
    expect(row.outcome).toBe('pending');
  });
});
