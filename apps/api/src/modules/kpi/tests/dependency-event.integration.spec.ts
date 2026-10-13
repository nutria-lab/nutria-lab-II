// NUT-85 T4 — Escritor de dependencias contra Postgres desechable (C2; design D3, D5, D9).
// Sólo KPI_TEST_DATABASE_URL; skip si falta; falla si el host no es local. Schema descartable por suite.
// Contrato fijado: insertDependencyPending INSERT 'pending'; closeDependency UPDATE condicional (outcome = 'pending')
// del mismo id; UNIQUE (environment, operation_id, dependency, attempt) ⇒ el 2º insert falla, se loguea sin
// mensaje y nunca rechaza.
import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { createKpiPrismaClient } from '../db/kpi-prisma';
import type { KpiPrismaHandle } from '../db/kpi-prisma';
import { PrismaKpiEventWriter } from '../events/kpi-event-writer';
import {
  DisposableSchema,
  applyMigrations,
  createDisposableSchema,
  describeIfKpiDb,
  kpiTestDatabaseUrl,
} from './kpi-test-db.fixture';

jest.setTimeout(60_000);

describeIfKpiDb('PrismaKpiEventWriter — kpi_dependency_event (integración Postgres)', () => {
  let db: DisposableSchema;
  let handle: KpiPrismaHandle;
  let writer: PrismaKpiEventWriter;
  const logLines: string[] = [];

  beforeAll(async () => {
    db = await createDisposableSchema();
    await applyMigrations(db.client);
    handle = createKpiPrismaClient(kpiTestDatabaseUrl() as string, { options: db.poolConfig().options });
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
    const record = (...args: unknown[]) => logLines.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    for (const method of ['log', 'error', 'warn', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, method).mockImplementation(record);
      jest.spyOn(Logger, method).mockImplementation(record);
    }
  });

  afterEach(() => jest.restoreAllMocks());

  const rowsOf = async (operationId: string) =>
    (await db.client.query(
      `SELECT id, environment, operation_id, dependency, attempt, outcome, started_at, finished_at, duration_ms
         FROM kpi_dependency_event WHERE operation_id = $1 ORDER BY attempt`,
      [operationId],
    )).rows;

  it('pending + close de dependencia sobre la DB real', async () => {
    const id = randomUUID();
    const operationId = randomUUID();
    const startedAt = new Date();

    await writer.insertDependencyPending({ id, environment: 'dev', operationId, dependency: 'gemini', attempt: 1, startedAt });
    expect(await rowsOf(operationId)).toEqual([
      expect.objectContaining({ id, environment: 'dev', dependency: 'gemini', attempt: 1, outcome: 'pending', finished_at: null, duration_ms: null }),
    ]);

    await writer.closeDependency({ id, outcome: 'timeout', finishedAt: new Date(startedAt.getTime() + 15), durationMs: 15 });
    await writer.drain(1000);
    const [row] = await rowsOf(operationId);
    expect(row).toEqual(expect.objectContaining({ outcome: 'timeout', duration_ms: 15 }));
    expect(row.finished_at).toBeInstanceOf(Date);

    // Un segundo cierre no pisa el primero (UPDATE condicional).
    await writer.closeDependency({ id, outcome: 'success', finishedAt: new Date(), durationMs: 99 });
    await writer.drain(1000);
    expect((await rowsOf(operationId))[0]).toEqual(expect.objectContaining({ outcome: 'timeout', duration_ms: 15 }));
  });

  it('UNIQUE (environment, operation_id, dependency, attempt) rechaza attempt repetido sin romper al llamador', async () => {
    const operationId = randomUUID();
    const base = { environment: 'dev' as const, operationId, dependency: 'unsplash_search' as const, attempt: 1, startedAt: new Date() };

    await writer.insertDependencyPending({ ...base, id: randomUUID() });
    await expect(writer.insertDependencyPending({ ...base, id: randomUUID() })).resolves.toBeUndefined();
    await writer.drain(1000);

    expect(await rowsOf(operationId)).toHaveLength(1);
    expect(logLines.join('\n')).toMatch(/KPI_WRITE_FAILED .*sqlstate=23505/);
    expect(logLines.join('\n')).not.toMatch(/duplicate key|postgresql:/i);

    await writer.insertDependencyPending({ ...base, id: randomUUID(), attempt: 2 });
    expect((await rowsOf(operationId)).map(r => r.attempt)).toEqual([1, 2]);
  });
});
