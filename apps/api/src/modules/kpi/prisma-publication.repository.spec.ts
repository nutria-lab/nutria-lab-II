import { createHash } from 'node:crypto';

import { freezeBatch } from './kpi-batch';
import { PrismaPublicationRepository } from './prisma-publication.repository';

const batch = freezeBatch({
  contract_version: '1', date: '2026-10-09', environment: 'dev',
  window_start: '2026-10-09T03:00:00.000Z', window_end: '2026-10-10T00:00:00.000Z', run_id: 'cbd79c1e-0f46-4e5a-b86b-02d354277791',
}, [
  { kpi_id: 'availability_rate', value: 100, quality: 'observed', reason: null, sample_count: 1, measured_at: '2026-10-10T00:00:00.000Z' },
]);

const payload = Buffer.from(JSON.stringify(batch.measurements), 'utf8');

function row(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'cbd79c1e-0f46-4e5a-b86b-02d354277791', environment: 'dev', reportDate: new Date('2026-10-09T00:00:00.000Z'),
    windowStart: new Date(batch.context.window_start), windowEnd: new Date(batch.context.window_end), status: 'frozen',
    frozenBatch: JSON.parse(JSON.stringify(batch)), payloadSha256: batch.payload_sha256, sourceCommit: 'a'.repeat(40),
    retryChainId: 'f2b8d1ab-a737-4191-9a19-22a1f4d4ab6d', attemptCount: 0, lastError: null,
    createdAt: new Date(), updatedAt: new Date(), acceptedAt: null, deliveredAt: null, ...overrides,
  };
}

function prismaMock(overrides: Record<string, unknown> = {}) {
  return { kpiPublication: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), ...overrides } };
}

describe('PrismaPublicationRepository (NUT-85 adapter)', () => {
  it('persists the resolved Argentina [00:00, 21:00) window on the first reservation, never equal bounds', async () => {
    const created = row({ status: 'preparing', frozenBatch: null, payloadSha256: null });
    const prisma = prismaMock({
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(created),
    });
    const repository = new PrismaPublicationRepository(prisma as never);

    await repository.reservePublication({
      environment: 'dev', date: '2026-10-09', runId: created.runId,
      sourceCommit: 'a'.repeat(40), retryChainId: created.retryChainId,
    });

    expect(prisma.kpiPublication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        windowStart: new Date('2026-10-09T03:00:00.000Z'),
        windowEnd: new Date('2026-10-10T00:00:00.000Z'),
      }),
    }));
  });

  it('refuses a well-ordered but non-contract window before creating any publication row', async () => {
    const prisma = prismaMock({
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    });
    const repository = new PrismaPublicationRepository(prisma as never);

    await expect(repository.reservePublication({
      environment: 'dev', date: '2026-10-09', runId: 'cbd79c1e-0f46-4e5a-b86b-02d354277791',
      sourceCommit: 'a'.repeat(40), retryChainId: 'f2b8d1ab-a737-4191-9a19-22a1f4d4ab6d',
      windowStart: '2026-10-09T04:00:00.000Z', windowEnd: '2026-10-09T22:00:00.000Z',
    })).rejects.toThrow('KPI_WINDOW_INVALID');
    expect(prisma.kpiPublication.create).not.toHaveBeenCalled();
  });

  it('reconstructs the canonical payload from JSONB and verifies the stored SHA before publishing', async () => {
    const prisma = prismaMock({ findUnique: jest.fn().mockResolvedValue(row()), updateMany: jest.fn().mockResolvedValue({ count: 1 }) });
    const repository = new PrismaPublicationRepository(prisma as never);

    const result = await repository.freezeBatchConditionally('cbd79c1e-0f46-4e5a-b86b-02d354277791', batch, payload);

    expect(result.won).toBe(true);
    expect(result.publication.frozenPayload).toEqual(payload);
    expect(createHash('sha256').update(result.publication.frozenPayload!).digest('hex')).toBe(batch.payload_sha256);
    expect(prisma.kpiPublication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ runId: 'cbd79c1e-0f46-4e5a-b86b-02d354277791' }),
      data: expect.objectContaining({ status: 'frozen', payloadSha256: batch.payload_sha256 }),
    }));
  });

  it('claims each 0→1→2→3 execution through one compare-and-set update over retry_chain_id and attempt_count', async () => {
    const prisma = prismaMock({ updateMany: jest.fn().mockResolvedValue({ count: 1 }) });
    const repository = new PrismaPublicationRepository(prisma as never);

    await expect(repository.claimAttempt({
      environment: 'dev', date: '2026-10-09', runId: 'cbd79c1e-0f46-4e5a-b86b-02d354277791',
      retryChainId: 'f2b8d1ab-a737-4191-9a19-22a1f4d4ab6d', attempt: 1,
    })).resolves.toEqual({ claimed: true });
    expect(prisma.kpiPublication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        environment: 'dev', reportDate: new Date('2026-10-09T00:00:00.000Z'),
        runId: 'cbd79c1e-0f46-4e5a-b86b-02d354277791', retryChainId: 'f2b8d1ab-a737-4191-9a19-22a1f4d4ab6d', attemptCount: 1,
        status: { in: ['preparing', 'frozen', 'failed'] }, acceptedAt: null, deliveredAt: null,
      }),
      data: expect.objectContaining({ attemptCount: { increment: 1 } }),
    }));
  });

  it('opens only an exhausted manual chain and preserves the frozen batch identity', async () => {
    const manualChainId = '68302990-bb52-4c9a-afc9-31ff4baa6300';
    const prisma = prismaMock({
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(row({
        retryChainId: manualChainId, attemptCount: 0, status: 'frozen', lastError: null,
      })),
    });
    const repository = new PrismaPublicationRepository(prisma as never);

    await expect(repository.recoverManually(batch.context.run_id, manualChainId)).resolves.toMatchObject({
      runId: batch.context.run_id,
      environment: 'dev',
      date: '2026-10-09',
      sourceCommit: 'a'.repeat(40),
      retryChainId: manualChainId,
      attemptCount: 0,
      status: 'frozen',
      frozenBatch: batch,
      payloadSha256: batch.payload_sha256,
    });
    expect(prisma.kpiPublication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        runId: batch.context.run_id,
        retryChainId: { not: manualChainId },
        status: 'failed',
        acceptedAt: null,
        deliveredAt: null,
        attemptCount: 3,
        frozenBatch: { not: expect.anything() },
        payloadSha256: { not: null },
      }),
      data: expect.objectContaining({ retryChainId: manualChainId, attemptCount: 0, status: 'frozen' }),
    }));
    const update = prisma.kpiPublication.updateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(update.data).not.toHaveProperty('frozenBatch');
    expect(update.data).not.toHaveProperty('payloadSha256');
    expect(update.data).not.toHaveProperty('sourceCommit');
    expect(update.data).not.toHaveProperty('reportDate');
  });

  it('never transitions an accepted row back to failed', async () => {
    const prisma = prismaMock({ updateMany: jest.fn().mockResolvedValue({ count: 0 }) });
    const repository = new PrismaPublicationRepository(prisma as never);

    await repository.markFailed('cbd79c1e-0f46-4e5a-b86b-02d354277791', 'REMOTE_POST_ERROR');

    expect(prisma.kpiPublication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ acceptedAt: null, deliveredAt: null }),
    }));
  });

  it('does not treat an unmatched acceptance update as durable accepted state', async () => {
    const prisma = prismaMock({
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(row({ status: 'frozen', acceptedAt: null, deliveredAt: null })),
    });
    const repository = new PrismaPublicationRepository(prisma as never);

    await expect(repository.markAccepted(batch.context.run_id, '2026-10-10T00:01:00.000Z'))
      .rejects.toThrow('KPI_PUBLICATION_ACCEPTANCE_PERSIST_FAILED');
  });

  it('does not treat an unmatched delivery update as durable delivered state', async () => {
    const prisma = prismaMock({
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(row({
        status: 'accepted', acceptedAt: new Date('2026-10-10T00:01:00.000Z'), deliveredAt: null,
      })),
    });
    const repository = new PrismaPublicationRepository(prisma as never);

    await expect(repository.markDelivered(batch.context.run_id, '2026-10-10T00:02:00.000Z'))
      .rejects.toThrow('KPI_PUBLICATION_DELIVERY_PERSIST_FAILED');
  });
});
