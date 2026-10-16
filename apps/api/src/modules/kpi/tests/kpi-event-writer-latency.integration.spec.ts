import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import type { Socket } from 'node:net';
import { createKpiPrismaClient, disposeKpiPrismaClient } from '../db/kpi-prisma';
import type { KpiPrismaHandle } from '../db/kpi-prisma';
import { KPI_WRITE_WAIT_MS, PrismaKpiEventWriter } from '../events/kpi-event-writer';
import {
  applyMigrations,
  createDisposableSchema,
  describeIfKpiDb,
  kpiTestDatabaseUrl,
} from './kpi-test-db.fixture';
import type { DisposableSchema } from './kpi-test-db.fixture';

jest.setTimeout(30_000);

describeIfKpiDb('KPI runtime writer over a slow database connection', () => {
  let db: DisposableSchema;
  let handle: KpiPrismaHandle;
  let writer: PrismaKpiEventWriter;
  let responseDelayMs = 0;
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const logs: string[] = [];
  const proxy = createServer(client => {
    const target = new URL(kpiTestDatabaseUrl()!);
    const upstream = createConnection({ host: target.hostname, port: Number(target.port || 5432) });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    }
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
    client.pipe(upstream);
    upstream.on('data', (chunk: Buffer) => {
      // Delay transport, not SQL execution: statement_timeout must stay effective.
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!client.destroyed) client.write(chunk);
      }, responseDelayMs);
      timers.add(timer);
    });
  });

  beforeAll(async () => {
    db = await createDisposableSchema();
    await applyMigrations(db.client);
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  });

  beforeEach(async () => {
    logs.length = 0;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(message => { logs.push(String(message)); });
    responseDelayMs = 0;
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('Local proxy did not start');
    const url = new URL(kpiTestDatabaseUrl()!);
    url.hostname = '127.0.0.1';
    url.port = String(address.port);
    handle = createKpiPrismaClient(url.toString(), { options: db.poolConfig().options });
    writer = new PrismaKpiEventWriter(handle.prisma);
    await handle.prisma.$queryRaw`SELECT 1`;
  });

  afterEach(async () => {
    responseDelayMs = 0;
    await writer?.drain(5000);
    if (handle) await disposeKpiPrismaClient(handle);
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
    await db?.drop();
  });

  it.each(['http', 'dependency'] as const)(
    'persists the %s terminal result when database responses exceed 150 ms',
    async kind => {
      const id = randomUUID();
      const startedAt = new Date();
      if (kind === 'http') {
        await writer.insertHttpPending({ id, environment: 'dev', operation: 'UNRESOLVED', startedAt });
      } else {
        await writer.insertDependencyPending({
          id, environment: 'dev', operationId: randomUUID(), dependency: 'unsplash_search', attempt: 1, startedAt,
        });
      }
      await writer.drain(1000);
      const table = kind === 'http' ? 'kpi_http_event' : 'kpi_dependency_event';
      const readRow = async () => (await db.client.query(
        `SELECT outcome, duration_ms, finished_at FROM ${table} WHERE id = $1`, [id],
      )).rows[0];
      expect(await readRow()).toMatchObject({ outcome: 'pending', duration_ms: null });

      responseDelayMs = 200;
      const began = performance.now();
      const terminal = { id, outcome: 'success' as const, finishedAt: new Date(), durationMs: 42 };
      if (kind === 'http') {
        await writer.closeHttp({ ...terminal, operation: 'GET /recipes/:id', httpStatus: 200 });
      } else {
        await writer.closeDependency(terminal);
      }
      // The caller remains bounded even though the transaction needs several round trips.
      expect(performance.now() - began).toBeLessThan(KPI_WRITE_WAIT_MS + 150);
      await writer.drain(5000);

      expect(await readRow()).toMatchObject({ outcome: 'success', duration_ms: 42, finished_at: expect.any(Date) });
      expect(writer.inFlightCount()).toBe(0);
      expect(logs.join('\n')).not.toContain('CLIENT_QUERY_TIMEOUT');
    },
  );
});
