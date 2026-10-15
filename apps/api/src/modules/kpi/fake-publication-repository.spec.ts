import { FakePublicationRepository } from './fake-publication.repository';
import { freezeBatch, canonicalPayloadBytes } from './kpi-batch';
import type { CollectionContext, KpiId, KpiResult } from './kpi-contract';

const context: CollectionContext = {
  contract_version: '1',
  date: '2026-10-09',
  environment: 'prod',
  window_start: '2026-10-09T03:00:00.000Z',
  window_end: '2026-10-10T00:00:00.000Z',
  run_id: 'run-86',
};

function batchFor(runId = context.run_id) {
  const result: KpiResult = {
    kpi_id: 'operations_count',
    value: 0,
    quality: 'observed',
    reason: null,
    sample_count: 0,
    measured_at: context.window_end,
  };
  const frozen = freezeBatch({ ...context, run_id: runId }, [result]);
  return { batch: frozen, bytes: canonicalPayloadBytes(frozen.measurements) };
}

describe('FakePublicationRepository', () => {
  it('uses the reserved publication row as the atomic retry claim, with one winner for each eligible next attempt', async () => {
    const repository = new FakePublicationRepository();

    const first = await repository.reservePublication({
      environment: 'prod',
      date: '2026-10-09',
      runId: 'run-86',
      sourceCommit: 'a'.repeat(40),
      retryChainId: 'f049dc13-8d9f-4c23-9f55-0f1a4d676fe4',
    });
    const second = await repository.reservePublication({
      environment: 'prod',
      date: '2026-10-09',
      runId: 'different-run-must-not-win',
      sourceCommit: 'b'.repeat(40),
      retryChainId: '160aeb84-c23b-4a2f-8bfa-6ae808bf0bea',
    });

    expect(second.runId).toBe(first.runId);
    expect(first).toMatchObject({ attemptCount: 0 });

    const retryOne = await Promise.all([
      repository.claimAttempt(first.retryChainId, 1),
      repository.claimAttempt(first.retryChainId, 1),
    ]);
    expect(retryOne.filter((result) => result.claimed)).toHaveLength(1);
    await expect(repository.getPublication('prod', '2026-10-09')).resolves.toMatchObject({ attemptCount: 1 });

    await expect(repository.claimAttempt(first.retryChainId, 2)).resolves.toEqual({ claimed: true });
    await expect(repository.getPublication('prod', '2026-10-09')).resolves.toMatchObject({ attemptCount: 2 });
    await expect(repository.claimAttempt(first.retryChainId, 3)).resolves.toEqual({ claimed: false });
  });

  it('rejects claims when the retry chain is wrong or the publication has known acceptance/delivery', async () => {
    const repository = new FakePublicationRepository();
    const publication = await repository.reservePublication({
      environment: 'prod', date: context.date, runId: context.run_id,
      sourceCommit: 'a'.repeat(40), retryChainId: 'f049dc13-8d9f-4c23-9f55-0f1a4d676fe4',
    });

    await expect(repository.claimAttempt('160aeb84-c23b-4a2f-8bfa-6ae808bf0bea', 1)).resolves.toEqual({ claimed: false });
    await repository.markAccepted(publication.runId, '2026-10-10T00:01:00.000Z');
    await expect(repository.claimAttempt(publication.retryChainId, 1)).resolves.toEqual({ claimed: false });
    await repository.markDelivered(publication.runId, '2026-10-10T00:02:00.000Z');
    await expect(repository.claimAttempt(publication.retryChainId, 1)).resolves.toEqual({ claimed: false });
  });

  it('uses conditional freeze as a concurrency-safe winner selection and retains failures with or without a batch', async () => {
    const repository = new FakePublicationRepository();
    const publication = await repository.reservePublication({
      environment: 'prod',
      date: context.date,
      runId: context.run_id,
      sourceCommit: 'a'.repeat(40),
      retryChainId: 'f049dc13-8d9f-4c23-9f55-0f1a4d676fe4',
    });
    const first = batchFor(publication.runId);
    const contender = batchFor('loser-run');

    const [winner, loser] = await Promise.all([
      repository.freezeBatchConditionally(publication.runId, first.batch, first.bytes),
      repository.freezeBatchConditionally(publication.runId, contender.batch, contender.bytes),
    ]);

    expect([winner.won, loser.won].filter(Boolean)).toHaveLength(1);
    expect(winner.publication.frozenPayload).toEqual(loser.publication.frozenPayload);
    expect(winner.publication.payloadSha256).toBe(loser.publication.payloadSha256);

    await repository.markFailed(publication.runId, 'NETWORK_ERROR');
    await expect(repository.getPublication('prod', context.date)).resolves.toMatchObject({
      status: 'failed',
      frozenBatch: expect.any(Object),
    });

    const unfrozen = await repository.reservePublication({
      environment: 'dev',
      date: context.date,
      runId: 'unfrozen-run',
      sourceCommit: 'b'.repeat(40),
      retryChainId: '160aeb84-c23b-4a2f-8bfa-6ae808bf0bea',
    });
    await repository.markFailed(unfrozen.runId, 'SOURCE_UNAVAILABLE');
    await expect(repository.getPublication('dev', context.date)).resolves.toMatchObject({
      status: 'failed',
      frozenBatch: null,
    });
  });

});
