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

function claim(repository: FakePublicationRepository, publication: { environment: 'dev' | 'qa' | 'prod'; date: string; runId: string; retryChainId: string }, attempt: 0 | 1 | 2) {
  return repository.claimAttempt({ environment: publication.environment, date: publication.date, runId: publication.runId, retryChainId: publication.retryChainId, attempt });
}

describe('FakePublicationRepository', () => {
  it('opens an explicit manual recovery chain after exhaustion without changing the frozen batch identity', async () => {
    const repository = new FakePublicationRepository();
    const publication = await repository.reservePublication({
      environment: 'prod', date: '2026-10-09', runId: 'f66cd499-0171-41dc-858f-bef11373f1f5',
      sourceCommit: 'a'.repeat(40), retryChainId: 'f049dc13-8d9f-4c23-9f55-0f1a4d676fe4',
    });
    const frozen = batchFor(publication.runId);
    await repository.freezeBatchConditionally(publication.runId, frozen.batch, frozen.bytes);
    await claim(repository, publication, 0);
    await claim(repository, publication, 1);
    await claim(repository, publication, 2);
    await repository.markFailed(publication.runId, 'REMOTE_TIMEOUT');
    const beforeRecovery = await repository.getPublication('prod', publication.date);

    const recovered = await repository.recoverManually!(publication.runId, '68302990-bb52-4c9a-afc9-31ff4baa6300');

    expect(recovered).toMatchObject({
      date: publication.date, runId: publication.runId, sourceCommit: publication.sourceCommit,
      retryChainId: '68302990-bb52-4c9a-afc9-31ff4baa6300', attemptCount: 0,
      frozenBatch: beforeRecovery.frozenBatch, frozenPayload: beforeRecovery.frozenPayload,
      payloadSha256: beforeRecovery.payloadSha256,
    });
  });

  it('uses the reserved publication row as the atomic 0→1→2→3 attempt chain, with one winner per execution', async () => {
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

    const initial = await Promise.all([
      claim(repository, first, 0),
      claim(repository, first, 0),
    ]);
    expect(initial.filter((result) => result.claimed)).toHaveLength(1);
    await expect(repository.getPublication('prod', '2026-10-09')).resolves.toMatchObject({ attemptCount: 1 });

    await expect(claim(repository, first, 1)).resolves.toEqual({ claimed: true });
    await expect(repository.getPublication('prod', '2026-10-09')).resolves.toMatchObject({ attemptCount: 2 });
    await expect(claim(repository, first, 2)).resolves.toEqual({ claimed: true });
    await expect(repository.getPublication('prod', '2026-10-09')).resolves.toMatchObject({ attemptCount: 3 });
    await expect(repository.claimAttempt({ environment: first.environment, date: first.date, runId: first.runId, retryChainId: first.retryChainId, attempt: 2 })).resolves.toEqual({ claimed: false });
  });

  it('rejects claims when the retry chain is wrong or the publication has known acceptance/delivery', async () => {
    const repository = new FakePublicationRepository();
    const publication = await repository.reservePublication({
      environment: 'prod', date: context.date, runId: context.run_id,
      sourceCommit: 'a'.repeat(40), retryChainId: 'f049dc13-8d9f-4c23-9f55-0f1a4d676fe4',
    });

    await expect(repository.claimAttempt({ environment: publication.environment, date: publication.date, runId: publication.runId, retryChainId: '160aeb84-c23b-4a2f-8bfa-6ae808bf0bea', attempt: 1 })).resolves.toEqual({ claimed: false });
    await repository.markAccepted(publication.runId, '2026-10-10T00:01:00.000Z');
    await expect(claim(repository, publication, 1)).resolves.toEqual({ claimed: false });
    await repository.markDelivered(publication.runId, '2026-10-10T00:02:00.000Z');
    await expect(claim(repository, publication, 1)).resolves.toEqual({ claimed: false });
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

  it('rejects manual recovery without the original frozen batch after all three attempts', async () => {
    const repository = new FakePublicationRepository();
    const publication = await repository.reservePublication({
      environment: 'dev', date: context.date, runId: 'not-frozen', sourceCommit: 'a'.repeat(40),
      retryChainId: 'f049dc13-8d9f-4c23-9f55-0f1a4d676fe4',
    });
    await claim(repository, publication, 0);
    await claim(repository, publication, 1);
    await claim(repository, publication, 2);
    await repository.markFailed(publication.runId, 'REMOTE_TIMEOUT');

    await expect(repository.recoverManually!(publication.runId, '68302990-bb52-4c9a-afc9-31ff4baa6300'))
      .rejects.toThrow('KPI_MANUAL_RECOVERY_NOT_ELIGIBLE');
  });

});
