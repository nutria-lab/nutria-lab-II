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

  it('claims retries through one compare-and-set update over retry_chain_id and attempt_count', async () => {
    const prisma = prismaMock({ updateMany: jest.fn().mockResolvedValue({ count: 1 }) });
    const repository = new PrismaPublicationRepository(prisma as never);

    await expect(repository.claimAttempt('f2b8d1ab-a737-4191-9a19-22a1f4d4ab6d', 2)).resolves.toEqual({ claimed: true });
    expect(prisma.kpiPublication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        retryChainId: 'f2b8d1ab-a737-4191-9a19-22a1f4d4ab6d', attemptCount: 1,
        status: { in: ['frozen', 'failed'] }, acceptedAt: null, deliveredAt: null,
      }),
      data: expect.objectContaining({ attemptCount: { increment: 1 } }),
    }));
  });

  it('never transitions an accepted row back to failed', async () => {
    const prisma = prismaMock({ updateMany: jest.fn().mockResolvedValue({ count: 0 }) });
    const repository = new PrismaPublicationRepository(prisma as never);

    await repository.markFailed('cbd79c1e-0f46-4e5a-b86b-02d354277791', 'REMOTE_POST_ERROR');

    expect(prisma.kpiPublication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ acceptedAt: null, deliveredAt: null }),
    }));
  });
});
