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
  remoteClient?: {
    post: jest.Mock;
    verify: jest.Mock;
  };
} = {}) {
  const repository = overrides.repository ?? new FakePublicationRepository();
  const logger = collector();
  const defaultRemoteClient = {
    post: jest.fn().mockResolvedValue({ kind: 'accepted', status: 202 }),
    verify: jest.fn().mockResolvedValue({ kind: 'match', status: 200 }),
  };
  const remoteClient = overrides.remoteClient ?? defaultRemoteClient;
  const artifactWriter = { write: jest.fn().mockResolvedValue(undefined) };
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

    await expect(publisher.publish(request)).resolves.toMatchObject({ status: 'delivered', postAccepted: true });

    const publication = await repository.getPublication('prod', date);
    expect(logger.collect).toHaveBeenCalledTimes(1);
    expect(remoteClient.post).toHaveBeenCalledWith(publication.frozenPayload);
    expect(publication).toMatchObject({ status: 'delivered', acceptedAt: expect.any(String), frozenBatch: expect.any(Object) });
  });

  it('reuses an already frozen authoritative batch without recollecting', async () => {
    const { publisher, repository, logger, remoteClient, request } = publisherHarness();
    const publication = await frozenPublication(repository as FakePublicationRepository);

    await publisher.publish(request);

    expect(logger.collect).not.toHaveBeenCalled();
    expect(remoteClient.post).toHaveBeenCalledWith(publication.frozenPayload);
  });

  it.each(['accepted', 'delivered'] as const)('does not recollect or repost a previously %s publication', async (status) => {
    const { publisher, repository, logger, remoteClient, request } = publisherHarness();
    await frozenPublication(repository as FakePublicationRepository, status);

    await publisher.publish(request);

    expect(logger.collect).not.toHaveBeenCalled();
    expect(remoteClient.post).not.toHaveBeenCalled();
  });

  it('never posts when durable freeze fails, and loses a concurrent freeze race to the authoritative batch', async () => {
    const failedFreezeRepository = new FakePublicationRepository();
    jest.spyOn(failedFreezeRepository, 'freezeBatchConditionally').mockRejectedValueOnce(new Error('db down'));
    const noFreeze = publisherHarness({ repository: failedFreezeRepository });
    await expect(noFreeze.publisher.publish(noFreeze.request)).rejects.toThrow('db down');
    expect(noFreeze.remoteClient.post).not.toHaveBeenCalled();

    const race = publisherHarness();
    const authoritative = await frozenPublication(race.repository as FakePublicationRepository);
    await race.publisher.publish(race.request);
    expect(race.remoteClient.post).toHaveBeenCalledWith(authoritative.frozenPayload);
  });

  it('rejects a corrupt frozen SHA before network I/O', async () => {
    const { publisher, repository, remoteClient, request } = publisherHarness();
    await frozenPublication(repository as FakePublicationRepository);
    await (repository as FakePublicationRepository).corruptPayloadShaForTest(runId, '0'.repeat(64));

    await expect(publisher.publish(request)).resolves.toMatchObject({ failureCode: 'BATCH_INTEGRITY_ERROR' });
    expect(remoteClient.post).not.toHaveBeenCalled();
  });

  it('keeps postAccepted in output/artifact and prevents repost when accepted persistence fails, without a separate evidence store', async () => {
    const repository = new FakePublicationRepository();
    jest.spyOn(repository, 'markAccepted').mockRejectedValueOnce(new Error('accepted persistence unavailable'));
    const schemaCompatibleRepository = withoutLegacyPostAcceptedEvidence(repository);
    const { publisher, remoteClient, artifactWriter, request } = publisherHarness({ repository: schemaCompatibleRepository });

    await expect(publisher.publish(request)).resolves.toMatchObject({ postAccepted: true, status: 'verify_pending' });
    await expect(publisher.publish(request)).resolves.toMatchObject({ postAccepted: true });
    expect(remoteClient.post).toHaveBeenCalledTimes(1);
    expect(artifactWriter.write).toHaveBeenCalledWith(expect.objectContaining({
      'diagnostics.json': expect.any(Buffer),
    }));
    expect(artifactWriter.write.mock.calls[0][0]['diagnostics.json'].toString('utf8')).toContain('"post_accepted":true');
  });

  it.each([
    ['unavailable', 'verify_pending'],
    ['conflict', 'failed'],
  ] as const)('maps remote verify %s without a second post', async (kind, expectedStatus) => {
    const { publisher, remoteClient, request } = publisherHarness({ remoteClient: {
      post: jest.fn().mockResolvedValue({ kind: 'accepted', status: 200 }),
      verify: jest.fn().mockResolvedValue({ kind, status: kind === 'conflict' ? 409 : 503 }),
    } });

    await expect(publisher.publish(request)).resolves.toMatchObject({ status: expectedStatus });
    expect(remoteClient.post).toHaveBeenCalledTimes(1);
  });

  it('skips a duplicate retry claim before it can post', async () => {
    const { publisher, repository, remoteClient, request } = publisherHarness();
    await frozenPublication(repository as FakePublicationRepository);
    await repository.claimAttempt(retryChainId, 1);

    await expect(publisher.publish({ ...request, attempt: 1 })).resolves.toMatchObject({ status: 'skipped_duplicate' });
    expect(remoteClient.post).not.toHaveBeenCalled();
  });
});

function withoutLegacyPostAcceptedEvidence(repository: FakePublicationRepository): PublicationRepository {
  const compatible = {
    reservePublication: repository.reservePublication.bind(repository),
    getPublication: repository.getPublication.bind(repository),
    freezeBatchConditionally: repository.freezeBatchConditionally.bind(repository),
    claimAttempt: repository.claimAttempt.bind(repository),
    markAccepted: repository.markAccepted.bind(repository),
    markDelivered: repository.markDelivered.bind(repository),
    markFailed: repository.markFailed.bind(repository),
  };
  return compatible as PublicationRepository;
}
