import { createHash } from 'node:crypto';

import { freezeBatch } from './kpi-batch';
import { PrismaPublicationRepository } from './prisma-publication.repository';
import type { KpiId, KpiResult } from './kpi-contract';

const batch = freezeBatch({
  contract_version: '1', date: '2026-10-09', environment: 'dev',
  window_start: '2026-10-09T03:00:00.000Z', window_end: '2026-10-10T00:00:00.000Z', run_id: 'cbd79c1e-0f46-4e5a-b86b-02d354277791',
}, [
  { kpi_id: 'availability_rate', value: 100, quality: 'observed', reason: null, sample_count: 1, measured_at: '2026-10-10T00:00:00.000Z' },
]);

const payload = Buffer.from(JSON.stringify(batch.measurements), 'utf8');

const currentIds: readonly KpiId[] = [
  'operations_count', 'error_rate', 'latency_p95_ms', 'health_status',
  'last_success_age_seconds', 'timeout_rate', 'dependency_error_rate', 'availability_rate',
  'initial_plans_count', 'manual_recipes_count', 'adherence_rate',
];
const adherenceEvidence = {
  numerator: 32,
  denominator: 40,
  quality: 'observed' as const,
  reason: null,
  collection_date: '2026-10-29',
  measured_at: '2026-10-29T03:00:00.000Z',
  environment: 'dev' as const,
};

function currentBatch(includeAdherence = true) {
  const ids = includeAdherence ? currentIds : currentIds.filter(id => id !== 'adherence_rate');
  const results: KpiResult[] = ids.map(kpi_id => ({
    kpi_id,
    value: kpi_id === 'adherence_rate' ? 80 : 0,
    quality: 'observed',
    reason: null,
    sample_count: kpi_id === 'adherence_rate' ? 40 : 0,
    measured_at: '2026-10-29T03:00:00.000Z',
    ...(kpi_id === 'adherence_rate' ? { evidence: adherenceEvidence } : {}),
  }));
  return freezeBatch({
    ...batch.context,
    date: '2026-10-29',
    window_start: '2026-10-29T03:00:00.000Z',
    window_end: '2026-10-30T00:00:00.000Z',
  }, results);
}

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
  it('reserves the fixed Argentina report window instead of an empty interval', async () => {
    const prisma = prismaMock({
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(row({ status: 'preparing', frozenBatch: null, payloadSha256: null })),
    });
    const repository = new PrismaPublicationRepository(prisma as never);

    await repository.reservePublication({
      environment: 'dev', date: '2026-10-09', runId: 'cbd79c1e-0f46-4e5a-b86b-02d354277791',
      sourceCommit: 'a'.repeat(40), retryChainId: 'f2b8d1ab-a737-4191-9a19-22a1f4d4ab6d',
    });

    expect(prisma.kpiPublication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        windowStart: new Date('2026-10-09T03:00:00.000Z'),
        windowEnd: new Date('2026-10-10T00:00:00.000Z'),
      }),
    }));
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

  it('round-trips eleven measurements and adherence evidence through the JSONB reader', async () => {
    const complete = currentBatch();
    const prisma = prismaMock({ findFirst: jest.fn().mockResolvedValue(row({
      reportDate: new Date('2026-10-29T00:00:00.000Z'),
      frozenBatch: JSON.parse(JSON.stringify(complete)),
      payloadSha256: complete.payload_sha256,
    })) });
    const repository = new PrismaPublicationRepository(prisma as never);

    const publication = await repository.getPublication('dev', '2026-10-29');

    expect(publication.frozenBatch?.measurements).toHaveLength(11);
    expect(publication.frozenBatch?.diagnostics).toHaveLength(11);
    expect(publication.frozenBatch?.diagnostics.find(item => item.kpi_id === 'adherence_rate'))
      .toMatchObject({ evidence: adherenceEvidence, sample_count: 40 });
    expect(publication.frozenPayload).toEqual(Buffer.from(JSON.stringify(complete.measurements), 'utf8'));
    expect(publication.payloadSha256).toBe(complete.payload_sha256);
  });

  it('reads a legacy frozen ten-result batch without enriching or recalculating it', async () => {
    const legacy = currentBatch(false);
    const prisma = prismaMock({ findFirst: jest.fn().mockResolvedValue(row({
      reportDate: new Date('2026-10-29T00:00:00.000Z'),
      frozenBatch: JSON.parse(JSON.stringify(legacy)),
      payloadSha256: legacy.payload_sha256,
    })) });
    const repository = new PrismaPublicationRepository(prisma as never);

    const publication = await repository.getPublication('dev', '2026-10-29');

    expect(publication.frozenBatch?.measurements).toHaveLength(10);
    expect(publication.frozenBatch?.measurements.some(item => item.kpi_id === 'adherence_rate')).toBe(false);
    expect(publication.frozenBatch?.diagnostics.some(item => item.kpi_id === 'adherence_rate')).toBe(false);
    expect(publication.frozenPayload).toEqual(Buffer.from(JSON.stringify(legacy.measurements), 'utf8'));
    expect(publication.payloadSha256).toBe(legacy.payload_sha256);
  });

  it('claims retries through one compare-and-set update over retry_chain_id and attempt_count', async () => {
    const prisma = prismaMock({ updateMany: jest.fn().mockResolvedValue({ count: 1 }) });
    const repository = new PrismaPublicationRepository(prisma as never);

    await expect(repository.claimAttempt('f2b8d1ab-a737-4191-9a19-22a1f4d4ab6d', 2)).resolves.toEqual({ claimed: true });
    expect(prisma.kpiPublication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        retryChainId: 'f2b8d1ab-a737-4191-9a19-22a1f4d4ab6d', attemptCount: 1,
        status: { in: ['preparing', 'frozen', 'failed'] }, acceptedAt: null, deliveredAt: null,
      }),
      data: expect.objectContaining({ attemptCount: { increment: 1 } }),
    }));
  });

  it('starts an explicit manual recovery with a new chain while retaining run_id and frozen bytes', async () => {
    const nextChainId = '2a6557ab-24b8-4fa1-93ae-3b2d1b5d2fd2';
    const failed = row({ status: 'failed', attemptCount: 3, lastError: 'REMOTE_POST_ERROR' });
    const recovered = row({ status: 'frozen', attemptCount: 0, retryChainId: nextChainId, lastError: null });
    const prisma = prismaMock({
      findFirst: jest.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(recovered),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    });
    const repository = new PrismaPublicationRepository(prisma as never);

    const result = await repository.beginManualRecovery({
      environment: 'dev', date: '2026-10-09', runId: failed.runId, sourceCommit: failed.sourceCommit,
      retryChainId: nextChainId,
    });

    expect(result).toMatchObject({ runId: failed.runId, retryChainId: nextChainId, attemptCount: 0, status: 'frozen' });
    expect(result.frozenPayload).toEqual(payload);
    expect(prisma.kpiPublication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ runId: failed.runId, status: 'failed', attemptCount: 3, acceptedAt: null }),
      data: expect.objectContaining({ retryChainId: nextChainId, attemptCount: 0, status: 'frozen', lastError: null }),
    }));
  });

  it('records a post-accepted remote conflict as failed while preserving its acceptance timestamp', async () => {
    const prisma = prismaMock({ updateMany: jest.fn().mockResolvedValue({ count: 1 }) });
    const repository = new PrismaPublicationRepository(prisma as never);

    await repository.markFailed('cbd79c1e-0f46-4e5a-b86b-02d354277791', 'REMOTE_VALUE_CONFLICT');

    expect(prisma.kpiPublication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ runId: 'cbd79c1e-0f46-4e5a-b86b-02d354277791', deliveredAt: null }),
      data: expect.objectContaining({ status: 'failed', lastError: 'REMOTE_VALUE_CONFLICT' }),
    }));
  });
});
