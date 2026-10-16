import { canonicalPayloadBytes, freezeBatch } from './kpi-batch';
import type { CollectionContext, KpiId, KpiLogger, KpiResult } from './kpi-contract';
import { FakePublicationRepository } from './fake-publication.repository';
import { KpiPublisher } from './kpi-publisher';
import type { PublicationRepository } from './publication-repository.port';

const ids: readonly KpiId[] = [
  'operations_count', 'error_rate', 'latency_p95_ms', 'health_status',
  'last_success_age_seconds', 'timeout_rate', 'dependency_error_rate', 'availability_rate',
  'initial_plans_count', 'manual_recipes_count',
];
const date = '2026-10-09';
const runId = 'run-86';
const retryChainId = 'f049dc13-8d9f-4c23-9f55-0f1a4d676fe4';
const sourceCommit = 'a'.repeat(40);

function result(kpi_id: KpiId): KpiResult {
  return { kpi_id, value: 0, quality: 'observed', reason: null, sample_count: 0, measured_at: '2026-10-10T00:00:00.000Z' };
}

function collector(): jest.Mocked<KpiLogger> {
  return { collect: jest.fn().mockResolvedValue(ids.map(result)) };
}

function publisherHarness(overrides: {
  repository?: PublicationRepository;
  artifactWriter?: { write: jest.Mock };
  remoteClient?: {
    post: jest.Mock;
    verify: jest.Mock;
  };
} = {}) {
  const repository = overrides.repository ?? new FakePublicationRepository();
  const logger = collector();
  const defaultRemoteClient = {
    post: jest.fn().mockResolvedValue({ kind: 'accepted', status: 202 }),
    verify: jest.fn()
      .mockResolvedValueOnce({ kind: 'not_found', status: 404 })
      .mockResolvedValue({ kind: 'match', status: 200 }),
  };
  const remoteClient = overrides.remoteClient ?? defaultRemoteClient;
  const artifactWriter = overrides.artifactWriter ?? { write: jest.fn().mockResolvedValue(undefined) };
  const publisher = new KpiPublisher({
    repository,
    logger,
    remoteClient,
    artifactWriter,
    clock: { now: () => new Date('2026-10-10T00:01:00.000Z') },
    idGenerator: { next: () => runId },
  });
  const request = { environment: 'prod' as const, date, sourceCommit, retryChainId, attempt: 0 };
  return { publisher, repository, logger, remoteClient, artifactWriter, request };
}

async function runPublication(publisher: KpiPublisher, request: Parameters<KpiPublisher['publish']>[0]) {
  const prepared = await publisher.publish({ ...request, phase: 'prepare-only' });
  if (prepared.status !== 'prepared') return prepared;
  return publisher.publish({ ...request, phase: 'post-frozen', artifactUploadConfirmed: true, runId: prepared.runId });
}

async function frozenPublication(repository: FakePublicationRepository, status: 'frozen' | 'accepted' | 'delivered' = 'frozen') {
  const publication = await repository.reservePublication({ environment: 'prod', date, runId, sourceCommit, retryChainId });
  const context: CollectionContext = {
    contract_version: '1', date, environment: 'prod', window_start: '2026-10-09T03:00:00.000Z',
    window_end: '2026-10-10T00:00:00.000Z', run_id: publication.runId,
  };
  const batch = freezeBatch(context, ids.map(result));
  await repository.freezeBatchConditionally(publication.runId, batch, canonicalPayloadBytes(batch.measurements));
  if (status === 'accepted' || status === 'delivered') await repository.markAccepted(publication.runId, '2026-10-10T00:01:00.000Z');
  if (status === 'delivered') await repository.markDelivered(publication.runId, '2026-10-10T00:02:00.000Z');
  return repository.getPublication('prod', date);
}

describe('KpiPublisher', () => {
  it('freshly collects, freezes durably, posts the exact frozen bytes, accepts, verifies MATCH, and delivers', async () => {
    const { publisher, repository, logger, remoteClient, request } = publisherHarness();

    await expect(runPublication(publisher, request)).resolves.toMatchObject({ status: 'delivered', postAccepted: true });

    const publication = await repository.getPublication('prod', date);
    expect(logger.collect).toHaveBeenCalledTimes(1);
    expect(remoteClient.post).toHaveBeenCalledWith(publication.frozenPayload);
    expect(publication).toMatchObject({ status: 'delivered', acceptedAt: expect.any(String), frozenBatch: expect.any(Object) });
  });

  it('reconciles an already frozen authoritative batch without recollecting or reposting', async () => {
    const { publisher, repository, logger, remoteClient, request } = publisherHarness({ remoteClient: {
      post: jest.fn().mockResolvedValue({ kind: 'accepted', status: 202 }),
      verify: jest.fn().mockResolvedValue({ kind: 'match', status: 200 }),
    } });
    const publication = await frozenPublication(repository as FakePublicationRepository);

    await expect(runPublication(publisher, request)).resolves.toMatchObject({ status: 'delivered', postAccepted: true });

    expect(logger.collect).not.toHaveBeenCalled();
    expect(remoteClient.verify).toHaveBeenCalledWith('prod', date, publication.frozenBatch!.measurements);
    expect(remoteClient.post).not.toHaveBeenCalled();
    await expect(repository.getPublication('prod', date)).resolves.toMatchObject({
      status: 'delivered', acceptedAt: expect.any(String), deliveredAt: expect.any(String),
    });
  });

  it('writes the exact frozen payload and diagnostics durably before the first POST', async () => {
    const events: string[] = [];
    const artifactWriter = { write: jest.fn(async (artifacts: Record<string, Buffer>) => {
      events.push('artifact');
      expect(artifacts['payload.json']).toBeInstanceOf(Buffer);
      expect(artifacts['diagnostics.json']).toBeInstanceOf(Buffer);
    }) };
    const remoteClient = {
      post: jest.fn(async () => { events.push('post'); return { kind: 'accepted' as const, status: 202 }; }),
      verify: jest.fn().mockResolvedValueOnce({ kind: 'not_found', status: 404 }).mockResolvedValue({ kind: 'match', status: 200 }),
    };
    const { publisher, repository, request } = publisherHarness({ artifactWriter, remoteClient });

    await expect(runPublication(publisher, request)).resolves.toMatchObject({ status: 'delivered', postAccepted: true });

    const postIndex = events.indexOf('post');
    expect(events[0]).toBe('artifact');
    expect(postIndex).toBeGreaterThan(0);
    expect(events.lastIndexOf('artifact')).toBeGreaterThan(postIndex);
    const publication = await repository.getPublication('prod', date);
    const firstArtifacts = artifactWriter.write.mock.calls[0][0] as Record<string, Buffer>;
    const firstDiagnostics = JSON.parse(firstArtifacts['diagnostics.json'].toString('utf8')) as Record<string, unknown>;
    expect(firstArtifacts['payload.json']).toEqual(publication.frozenPayload);
    expect(firstDiagnostics).toMatchObject({
      run_id: publication.runId, payload_sha256: publication.payloadSha256,
      status: 'frozen', post_accepted: false, retry: { retry_chain_id: retryChainId, attempt: 0 },
    });
    const postAcceptedEvidence = artifactWriter.write.mock.calls
      .slice(1)
      .map(([artifacts]) => JSON.parse((artifacts as Record<string, Buffer>)['diagnostics.json'].toString('utf8')) as Record<string, unknown>);
    expect(postAcceptedEvidence).toEqual(expect.arrayContaining([expect.objectContaining({ post_accepted: true })]));
  });

  it('does not POST if it cannot persist the pre-POST frozen artifact', async () => {
    const artifactWriter = { write: jest.fn().mockRejectedValue(new Error('durable artifact store unavailable')) };
    const { publisher, remoteClient, request } = publisherHarness({ artifactWriter });

    await runPublication(publisher, request).catch(() => undefined);

    expect(artifactWriter.write).toHaveBeenCalledWith(expect.objectContaining({
      'payload.json': expect.any(Buffer), 'diagnostics.json': expect.any(Buffer),
    }));
    expect(remoteClient.post).not.toHaveBeenCalled();
  });

  it.each(['accepted', 'delivered'] as const)('does not recollect or repost a previously %s publication', async (status) => {
    const { publisher, repository, logger, remoteClient, request } = publisherHarness();
    await frozenPublication(repository as FakePublicationRepository, status);

    await runPublication(publisher, request);

    expect(logger.collect).not.toHaveBeenCalled();
    expect(remoteClient.post).not.toHaveBeenCalled();
  });

  it('never posts when durable freeze fails', async () => {
    const failedFreezeRepository = new FakePublicationRepository();
    jest.spyOn(failedFreezeRepository, 'freezeBatchConditionally').mockRejectedValueOnce(new Error('db down'));
    const noFreeze = publisherHarness({ repository: failedFreezeRepository });
    await expect(runPublication(noFreeze.publisher, noFreeze.request)).rejects.toThrow('db down');
    expect(noFreeze.remoteClient.post).not.toHaveBeenCalled();
  });

  it('rejects a corrupt frozen SHA before network I/O', async () => {
    const { publisher, repository, remoteClient, request } = publisherHarness();
    await frozenPublication(repository as FakePublicationRepository);
    await (repository as FakePublicationRepository).corruptPayloadShaForTest(runId, '0'.repeat(64));

    await expect(runPublication(publisher, request)).resolves.toMatchObject({ failureCode: 'BATCH_INTEGRITY_ERROR' });
    expect(remoteClient.post).not.toHaveBeenCalled();
  });

  it('fails closed without recollecting when a persisted frozen batch is missing its SHA', async () => {
    const { publisher, repository, logger, remoteClient, request } = publisherHarness();
    const publication = await frozenPublication(repository as FakePublicationRepository);
    publication.payloadSha256 = null;

    await expect(runPublication(publisher, request)).resolves.toMatchObject({
      status: 'failed', failureCode: 'BATCH_INTEGRITY_ERROR',
    });
    expect(logger.collect).not.toHaveBeenCalled();
    expect(remoteClient.post).not.toHaveBeenCalled();
  });

  it('reconciles a remote MATCH after restart when accepted persistence failed, without reposting', async () => {
    const repository = new FakePublicationRepository();
    jest.spyOn(repository, 'markAccepted').mockRejectedValueOnce(new Error('accepted persistence unavailable'));
    const schemaCompatibleRepository = withoutLegacyPostAcceptedEvidence(repository);
    const remoteClient = {
      post: jest.fn().mockResolvedValue({ kind: 'accepted', status: 202 }),
      verify: jest.fn().mockResolvedValueOnce({ kind: 'not_found', status: 404 }).mockResolvedValue({ kind: 'match', status: 200 }),
    };
    const first = publisherHarness({ repository: schemaCompatibleRepository, remoteClient });

    await expect(runPublication(first.publisher, first.request)).resolves.toMatchObject({ postAccepted: true, status: 'verify_pending' });
    const second = publisherHarness({ repository: schemaCompatibleRepository, remoteClient });

    await expect(runPublication(second.publisher, second.request)).resolves.toMatchObject({ postAccepted: true, status: 'delivered' });
    expect(remoteClient.post).toHaveBeenCalledTimes(1);
    expect(first.artifactWriter.write).toHaveBeenCalledWith(expect.objectContaining({
      'diagnostics.json': expect.any(Buffer),
    }));
    const evidence = first.artifactWriter.write.mock.calls.map(([artifacts]) =>
      JSON.parse((artifacts as Record<string, Buffer>)['diagnostics.json'].toString('utf8')) as Record<string, unknown>);
    expect(evidence[0]).toMatchObject({ status: 'frozen', post_accepted: false });
    expect(evidence.slice(1)).toEqual(expect.arrayContaining([expect.objectContaining({ post_accepted: true })]));
    await expect(repository.getPublication('prod', date)).resolves.toMatchObject({ status: 'delivered', acceptedAt: expect.any(String) });
  });

  it('reuses the frozen bytes and permits a POST only after recovered-batch GET returns NOT_FOUND', async () => {
    const repository = new FakePublicationRepository();
    const publication = await frozenPublication(repository);
    const remoteClient = {
      post: jest.fn().mockResolvedValue({ kind: 'accepted', status: 202 }),
      verify: jest.fn()
        .mockResolvedValueOnce({ kind: 'not_found', status: 404 })
        .mockResolvedValueOnce({ kind: 'match', status: 200 }),
    };
    const { publisher, logger, request } = publisherHarness({ repository, remoteClient });

    await expect(runPublication(publisher, request)).resolves.toMatchObject({ status: 'delivered', postAccepted: true });
    expect(logger.collect).not.toHaveBeenCalled();
    expect(remoteClient.verify).toHaveBeenCalledWith('prod', date, publication.frozenBatch!.measurements);
    expect(remoteClient.post).toHaveBeenCalledTimes(1);
    expect(remoteClient.post).toHaveBeenCalledWith(publication.frozenPayload);
  });

  it('keeps a recovered frozen batch verify-pending when remote verification is unavailable', async () => {
    const { publisher, repository, remoteClient, request } = publisherHarness({ remoteClient: {
      post: jest.fn().mockResolvedValue({ kind: 'accepted', status: 202 }),
      verify: jest.fn().mockResolvedValue({ kind: 'unavailable', status: 503 }),
    } });
    await frozenPublication(repository as FakePublicationRepository);

    await expect(runPublication(publisher, request)).resolves.toMatchObject({ status: 'verify_pending', postAccepted: false });
    expect(remoteClient.post).not.toHaveBeenCalled();
  });

  it('treats a recovered frozen batch whose verification GET throws as verify-pending without POST', async () => {
    const { publisher, repository, remoteClient, request } = publisherHarness({ remoteClient: {
      post: jest.fn().mockResolvedValue({ kind: 'accepted', status: 202 }),
      verify: jest.fn().mockRejectedValue({ kind: 'network' }),
    } });
    await frozenPublication(repository as FakePublicationRepository);

    await expect(runPublication(publisher, request)).resolves.toMatchObject({
      status: 'verify_pending', postAccepted: false, retryable: true,
    });
    expect(remoteClient.post).not.toHaveBeenCalled();
  });

  it('fails definitively without POST when a recovered frozen batch conflicts remotely', async () => {
    const { publisher, repository, remoteClient, request } = publisherHarness({ remoteClient: {
      post: jest.fn().mockResolvedValue({ kind: 'accepted', status: 202 }),
      verify: jest.fn().mockResolvedValue({ kind: 'conflict', status: 409 }),
    } });
    await frozenPublication(repository as FakePublicationRepository);

    await expect(runPublication(publisher, request)).resolves.toMatchObject({
      status: 'failed', failureCode: 'REMOTE_VALUE_CONFLICT',
    });
    expect(remoteClient.post).not.toHaveBeenCalled();
  });

  it('recovers a preparing reservation with no run_id by preserving the reserved run and freezing once', async () => {
    const repository = new FakePublicationRepository();
    const reservation = await repository.reservePublication({
      environment: 'prod', date, runId, sourceCommit, retryChainId,
    });
    await repository.claimAttempt({ environment: 'prod', date, runId: reservation.runId, retryChainId, attempt: 0 });
    const { publisher, logger, remoteClient } = publisherHarness({ repository, remoteClient: {
      post: jest.fn().mockResolvedValue({ kind: 'accepted', status: 202 }),
      verify: jest.fn().mockResolvedValueOnce({ kind: 'not_found', status: 404 }).mockResolvedValue({ kind: 'match', status: 200 }),
    } });

    await expect(runPublication(publisher, {
      environment: 'prod', date, sourceCommit, retryChainId, attempt: 1,
      // runId is intentionally absent: the durable date/environment row owns it.
    })).resolves.toMatchObject({ status: 'delivered', postAccepted: true });

    expect(logger.collect).toHaveBeenCalledTimes(1);
    expect(remoteClient.post).toHaveBeenCalledTimes(1);
    const recovered = await repository.getPublication('prod', date);
    expect(recovered).toMatchObject({ runId: reservation.runId, retryChainId, attemptCount: 2, status: 'delivered' });
    expect(remoteClient.post).toHaveBeenCalledWith(recovered.frozenPayload);
  });

  it('recovers an existing frozen retry row without run_id and never recollects or replaces its payload', async () => {
    const repository = new FakePublicationRepository();
    const publication = await frozenPublication(repository);
    await repository.claimAttempt({ environment: 'prod', date, runId: publication.runId, retryChainId, attempt: 0 });
    const remoteClient = {
      post: jest.fn().mockResolvedValue({ kind: 'accepted', status: 202 }),
      verify: jest.fn()
        .mockResolvedValueOnce({ kind: 'not_found', status: 404 })
        .mockResolvedValueOnce({ kind: 'match', status: 200 }),
    };
    const { publisher, logger } = publisherHarness({ repository, remoteClient });

    await expect(runPublication(publisher, {
      environment: 'prod', date, sourceCommit, retryChainId, attempt: 1,
      // The repository's unique environment/date row supplies the stable run ID.
    })).resolves.toMatchObject({ status: 'delivered', postAccepted: true });

    expect(logger.collect).not.toHaveBeenCalled();
    expect(remoteClient.verify).toHaveBeenCalledWith('prod', date, publication.frozenBatch!.measurements);
    expect(remoteClient.post).toHaveBeenCalledTimes(1);
    expect(remoteClient.post).toHaveBeenCalledWith(publication.frozenPayload);
    await expect(repository.getPublication('prod', date)).resolves.toMatchObject({
      runId: publication.runId, attemptCount: 2, payloadSha256: publication.payloadSha256,
    });
  });

  it.each([
    ['unavailable', 'verify_pending'],
    ['conflict', 'failed'],
  ] as const)('maps remote verify %s without a second post', async (kind, expectedStatus) => {
    const { publisher, remoteClient, request } = publisherHarness({ remoteClient: {
      post: jest.fn().mockResolvedValue({ kind: 'accepted', status: 200 }),
      verify: jest.fn().mockResolvedValue({ kind, status: kind === 'conflict' ? 409 : 503 }),
    } });

    await expect(runPublication(publisher, request)).resolves.toMatchObject({ status: expectedStatus });
    expect(remoteClient.post).not.toHaveBeenCalled();
  });

  it('allows one retry winner for a matching run_id/chain and skips a duplicate dispatch before POST', async () => {
    const repository = new FakePublicationRepository();
    const publication = await frozenPublication(repository);
    await repository.claimAttempt({ environment: 'prod', date, runId: publication.runId, retryChainId, attempt: 0 });
    const remoteClient = {
      post: jest.fn().mockResolvedValue({ kind: 'accepted', status: 202 }),
      verify: jest.fn()
        .mockResolvedValueOnce({ kind: 'not_found', status: 404 })
        .mockResolvedValueOnce({ kind: 'match', status: 200 }),
    };
    const first = publisherHarness({ repository, remoteClient });
    const duplicate = publisherHarness({ repository, remoteClient });
    const retry = { ...first.request, attempt: 1 as const, runId: publication.runId };

    const results = await Promise.all([
      runPublication(first.publisher, retry), runPublication(duplicate.publisher, retry),
    ]);

    expect(results.filter(result => result.status === 'skipped_duplicate')).toHaveLength(1);
    expect(remoteClient.post).toHaveBeenCalledTimes(1);
    expect(remoteClient.post).toHaveBeenCalledWith(publication.frozenPayload);
    expect(first.logger.collect).not.toHaveBeenCalled();
    expect(duplicate.logger.collect).not.toHaveBeenCalled();
    await expect(repository.getPublication('prod', date)).resolves.toMatchObject({
      runId: publication.runId, retryChainId, attemptCount: 2,
    });
  });
});

function withoutLegacyPostAcceptedEvidence(repository: FakePublicationRepository): PublicationRepository {
  const compatible = {
    reservePublication: repository.reservePublication.bind(repository),
    getPublication: repository.getPublication.bind(repository),
    freezeBatchConditionally: repository.freezeBatchConditionally.bind(repository),
    claimAttempt: repository.claimAttempt.bind(repository),
    claimPostAttempt: repository.claimPostAttempt.bind(repository),
    markAccepted: repository.markAccepted.bind(repository),
    markDelivered: repository.markDelivered.bind(repository),
    markFailed: repository.markFailed.bind(repository),
  };
  return compatible as PublicationRepository;
}
