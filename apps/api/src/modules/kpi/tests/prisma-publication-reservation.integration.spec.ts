import { randomUUID } from 'crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaPublicationRepository } from '../prisma-publication.repository';
import { applyMigrations, createDisposableSchema, describeIfKpiDb } from './kpi-test-db.fixture';
import type { DisposableSchema } from './kpi-test-db.fixture';

jest.setTimeout(60_000);

describeIfKpiDb('NUT-86 — reserva de publication con ventana Argentina en PostgreSQL', () => {
  let db: DisposableSchema;

  beforeAll(async () => {
    db = await createDisposableSchema();
    await applyMigrations(db.client);
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('persists the valid Argentina [00:00, 21:00) window accepted by the database CHECK', async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg(db.createPool({ max: 2 })) });
    const repository = new PrismaPublicationRepository(prisma as never);
    const reservation = {
      environment: 'dev' as const,
      date: '2050-04-05',
      runId: randomUUID(),
      sourceCommit: 'a'.repeat(40),
      retryChainId: randomUUID(),
      windowStart: '2050-04-05T03:00:00.000Z',
      windowEnd: '2050-04-06T00:00:00.000Z',
    };

    try {
      const created = await repository.reservePublication(reservation);
      const loaded = await repository.getPublication('dev', reservation.date);

      expect(created).toMatchObject({
        runId: reservation.runId, status: 'preparing', frozenBatch: null, attemptCount: 0,
      });
      expect(loaded).toMatchObject({ runId: reservation.runId, date: reservation.date });
      const row = await db.client.query<{ window_start: Date; window_end: Date }>(
        'SELECT window_start, window_end FROM kpi_publication WHERE run_id = $1',
        [reservation.runId],
      );
      expect(row.rows[0].window_start.toISOString()).toBe(reservation.windowStart);
      expect(row.rows[0].window_end.toISOString()).toBe(reservation.windowEnd);
    } finally {
      await prisma.$disconnect();
    }
  });
});
