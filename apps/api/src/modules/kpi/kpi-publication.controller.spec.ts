import { BadRequestException } from '@nestjs/common';

import { freezeBatch } from './kpi-batch';
import type { CollectionContext, FrozenBatch, KpiEnvironment, KpiId, KpiResult } from './kpi-contract';
import type { KpiConfig } from './config/kpi-config';
import { canonicalPayloadBytes } from './kpi-batch';
import { KpiPublicationController } from './kpi-publication.controller';
import type { PublicationRecord, PublicationRepository } from './publication-repository.port';

const IDS: readonly KpiId[] = [
  'operations_count', 'error_rate', 'latency_p95_ms', 'health_status',
  'last_success_age_seconds', 'timeout_rate', 'dependency_error_rate', 'availability_rate',
  'initial_plans_count', 'manual_recipes_count',
];

const context: CollectionContext = {
  contract_version: '1',
  date: '2026-10-09',
  environment: 'dev',
  window_start: '2026-10-09T03:00:00.000Z',
  window_end: '2026-10-10T00:00:00.000Z',
  run_id: 'cbd79c1e-0f46-4e5a-b86b-02d354277791',
};

function results(): KpiResult[] {
  return IDS.map(kpi_id => ({
    kpi_id,
    value: 0,
    quality: 'observed',
    reason: null,
    sample_count: 1,
    measured_at: context.window_end,
  }));
}

const batch = freezeBatch(context, results());

function publication(overrides: Partial<PublicationRecord> = {}): PublicationRecord {
  return {
    runId: context.run_id,
    environment: context.environment,
    date: context.date,
    sourceCommit: 'a'.repeat(40),
    retryChainId: 'f2b8d1ab-a737-4191-9a19-22a1f4d4ab6d',
    status: 'preparing',
    frozenBatch: null,
    frozenPayload: null,
    payloadSha256: null,
    acceptedAt: null,
    deliveredAt: null,
    failureCode: null,
    attemptCount: 0,
    ...overrides,
  };
}

function setup() {
  const repository: jest.Mocked<PublicationRepository> = {
    reservePublication: jest.fn(async (_reservation) => publication()),
    getPublication: jest.fn(async (_environment: KpiEnvironment, _date: string) => publication()),
    freezeBatchConditionally: jest.fn(async (_runId: string, _batch: FrozenBatch, _payload: Buffer) => ({ won: true, publication: publication({ frozenBatch: batch }) })),
    claimAttempt: jest.fn(async (_retryChainId: string, _attempt: number) => ({ claimed: true })),
    markAccepted: jest.fn(async (_runId: string, _acceptedAt: string) => undefined),
    markDelivered: jest.fn(async (_runId: string, _deliveredAt: string) => undefined),
    markFailed: jest.fn(async (_runId: string, _failureCode: string) => undefined),
  };
  const config = { environment: 'dev' } as KpiConfig;
  return { repository, controller: new KpiPublicationController(repository as never, config) };
}

describe('KpiPublicationController', () => {
  it('routes publication reservation through the backend repository without returning binary payload bytes', async () => {
    const { repository, controller } = setup();
    const reservation = {
      environment: 'dev', date: context.date, runId: context.run_id,
      sourceCommit: 'a'.repeat(40), retryChainId: 'f2b8d1ab-a737-4191-9a19-22a1f4d4ab6d',
    };

    const result = await controller.reserve({ reservation });

    expect(repository.reservePublication).toHaveBeenCalledWith(reservation);
    expect(result).toMatchObject({ runId: context.run_id, status: 'preparing' });
    expect(result).not.toHaveProperty('frozenPayload');
  });

  it('rejects a request for an environment other than the backend environment', async () => {
    const { repository, controller } = setup();

    await expect(controller.get({ environment: 'prod', date: context.date })).rejects.toThrow(BadRequestException);

    expect(repository.getPublication).not.toHaveBeenCalled();
  });

  it('validates and freezes the complete batch through the backend repository', async () => {
    const { repository, controller } = setup();

    const result = await controller.freeze({ run_id: context.run_id, batch });

    expect(repository.freezeBatchConditionally).toHaveBeenCalledWith(
      context.run_id,
      batch,
      canonicalPayloadBytes(batch.measurements),
    );
    expect(result).toMatchObject({ won: true, publication: { frozenBatch: batch } });
    expect(result.publication).not.toHaveProperty('frozenPayload');
  });

  it('rejects malformed frozen payloads and non-technical failure details before touching the database', async () => {
    const { repository, controller } = setup();

    await expect(controller.freeze({ run_id: context.run_id, batch: { ...batch, payload_sha256: 'f'.repeat(64) } }))
      .rejects.toThrow(BadRequestException);
    await expect(controller.markFailed({ run_id: context.run_id, failure_code: 'contains personal data' }))
      .rejects.toThrow(BadRequestException);

    expect(repository.freezeBatchConditionally).not.toHaveBeenCalled();
    expect(repository.markFailed).not.toHaveBeenCalled();
  });
});
