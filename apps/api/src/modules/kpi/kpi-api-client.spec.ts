import { ApiFirstKpiLogger, ApiFirstPublicationRepository, KpiApiClient, KpiResponseError, KpiTransportError } from './kpi-api-client';
import type { CollectionContext, FrozenBatch, KpiEnvironment, KpiResult } from './kpi-contract';
import type { PublicationRecord, PublicationRepository, PublicationReservation } from './publication-repository.port';

const IDS = [
  'operations_count', 'error_rate', 'latency_p95_ms', 'health_status',
  'last_success_age_seconds', 'timeout_rate', 'dependency_error_rate', 'availability_rate',
  'initial_plans_count', 'manual_recipes_count',
] as const;

const context: CollectionContext = {
  contract_version: '1',
  date: '2026-10-12',
  environment: 'dev',
  window_start: '2026-10-12T03:00:00.000Z',
  window_end: '2026-10-13T00:00:00.000Z',
  run_id: 'e2b9611a-4c18-4b9a-a570-715f2f965fe1',
};

function results(): KpiResult[] {
  return IDS.map(kpi_id => ({
    kpi_id,
    value: 0,
    quality: 'observed',
    reason: null,
    sample_count: 1,
    measured_at: '2026-10-13T00:05:00.000Z',
  }));
}

const reservation: PublicationReservation = {
  environment: 'dev',
  date: '2026-10-12',
  runId: context.run_id,
  sourceCommit: 'a'.repeat(40),
  retryChainId: 'f049dc13-8d9f-4c23-9f55-0f1a4d676fe4',
};

function publication(): PublicationRecord {
  return {
    ...reservation,
    status: 'preparing',
    frozenBatch: null,
    frozenPayload: null,
    payloadSha256: null,
    acceptedAt: null,
    deliveredAt: null,
    failureCode: null,
    attemptCount: 0,
  };
}

describe('KpiApiClient', () => {
  it('POSTs the collection context to the internal endpoint with bearer auth', async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify(results()), { status: 200 }));
    const client = new KpiApiClient('https://nutria.example/', 'internal-secret', 1000, fetcher);

    await expect(client.collect(context)).resolves.toHaveLength(10);

    expect(fetcher).toHaveBeenCalledWith('https://nutria.example/kpi/collect', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer internal-secret' }),
      body: JSON.stringify(context),
    }));
  });

  it('POSTs publication state operations through the backend API', async () => {
    const { frozenPayload: _unused, ...dto } = publication();
    const fetcher = jest.fn(async () => new Response(JSON.stringify(dto), { status: 200 }));
    const client = new KpiApiClient('https://nutria.example/', 'internal-secret', 1000, fetcher);

    await expect(client.reservePublication(reservation)).resolves.toMatchObject({ runId: reservation.runId });

    expect(fetcher).toHaveBeenCalledWith('https://nutria.example/kpi/publications/reserve', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer internal-secret' }),
      body: JSON.stringify({ reservation }),
    }));
  });

  it('validates health sample endpoint response shape before accepting it', async () => {
    const sampleResponse = {
      sample: { outcome: 'healthy', inserted: true, reason: null },
      preview: { executed: true, skip_reason: null, reused: false, results: results().slice(0, 8) },
      counts: { http_terminal: 3, http_pending_incomplete: 0, dependency_attempts: 1, health_samples: 1 },
      purge: { executed: false, cutoff: null, deleted: null },
    };
    const fetcher = jest.fn(async () => new Response(JSON.stringify(sampleResponse), { status: 200 }));
    const client = new KpiApiClient('https://nutria.example', 'token', 1000, fetcher);

    await expect(client.sample({
      scheduled_for: '2026-10-12T15:30:00.000Z', measured_at: '2026-10-12T15:47:12.345Z',
      api_ok: true, database_ok: true, reason: null,
    })).resolves.toEqual(sampleResponse);
  });

  it('does not enable fallback for an HTTP error response', async () => {
    const fetcher = jest.fn(async () => new Response('{}', { status: 503 }));
    const client = new KpiApiClient('https://nutria.example', 'token', 1000, fetcher);
    const fallback = { collect: jest.fn(async () => results()) };
    const logger = new ApiFirstKpiLogger(client, fallback);

    await expect(logger.collect(context)).rejects.toMatchObject({
      name: 'KpiResponseError',
      status: 503,
      code: 'KPI_API_HTTP_ERROR',
    });
    expect(fallback.collect).not.toHaveBeenCalled();
  });

  it('uses the DB-backed logger only when no HTTP response arrives', async () => {
    const fetcher = jest.fn(async () => { throw new TypeError('network down'); });
    const client = new KpiApiClient('https://nutria.example', 'token', 1000, fetcher);
    const fallback = { collect: jest.fn(async () => results()) };
    const logger = new ApiFirstKpiLogger(client, fallback);

    await expect(logger.collect(context)).resolves.toHaveLength(10);
    expect(fallback.collect).toHaveBeenCalledWith(context);
  });

  it('rejects malformed successful responses without falling back', async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify(results().slice(0, 9)), { status: 200 }));
    const client = new KpiApiClient('https://nutria.example', 'token', 1000, fetcher);
    const fallback = { collect: jest.fn(async () => results()) };

    await expect(new ApiFirstKpiLogger(client, fallback).collect(context)).rejects.toBeInstanceOf(KpiResponseError);
    expect(fallback.collect).not.toHaveBeenCalled();
  });

  it('tags a timed out request as a transport failure', async () => {
    const fetcher = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const client = new KpiApiClient('https://nutria.example', 'token', 5, fetcher);

    await expect(client.collect(context)).rejects.toEqual(expect.objectContaining({
      constructor: KpiTransportError,
      code: 'KPI_API_TIMEOUT',
    }));
  });

  it('tags a timeout while reading the response body as a transport failure', async () => {
    const fetcher = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const response = new Response('{}', { status: 200 });
      jest.spyOn(response, 'json').mockImplementation(() => new Promise((_resolve, reject) => {
        const abort = () => reject(new Error('aborted'));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener('abort', abort, { once: true });
      }));
      return response;
    });
    const client = new KpiApiClient('https://nutria.example', 'token', 20, fetcher);

    await expect(client.collect(context)).rejects.toEqual(expect.objectContaining({
      constructor: KpiTransportError,
      code: 'KPI_API_TIMEOUT',
    }));
  });
});

describe('ApiFirstPublicationRepository', () => {
  function repository(): jest.Mocked<PublicationRepository> {
    return {
      reservePublication: jest.fn(async (_reservation: PublicationReservation) => publication()),
      getPublication: jest.fn(async (_environment: KpiEnvironment, _date: string) => publication()),
      freezeBatchConditionally: jest.fn(async (_runId: string, _batch: FrozenBatch, _payload: Buffer) => ({ won: true, publication: publication() })),
      claimAttempt: jest.fn(async (_retryChainId: string, _attempt: number) => ({ claimed: true })),
      markAccepted: jest.fn(async (_runId: string, _acceptedAt: string) => undefined),
      markDelivered: jest.fn(async (_runId: string, _deliveredAt: string) => undefined),
      markFailed: jest.fn(async (_runId: string, _failureCode: string) => undefined),
    };
  }

  it('uses the API and never constructs the local DB fallback after a successful response', async () => {
    const api = repository();
    const local = repository();
    const fallback = jest.fn(() => local);
    const apiFirst = new ApiFirstPublicationRepository(api, fallback);

    await expect(apiFirst.reservePublication(reservation)).resolves.toMatchObject({ runId: reservation.runId });

    expect(api.reservePublication).toHaveBeenCalledWith(reservation);
    expect(fallback).not.toHaveBeenCalled();
    expect(local.reservePublication).not.toHaveBeenCalled();
  });

  it('uses local Prisma only when the endpoint returns no HTTP response', async () => {
    const fetcher = jest.fn(async () => { throw new TypeError('network down'); });
    const apiClient = new KpiApiClient('https://nutria.example', 'token', 1000, fetcher);
    const local = repository();
    const fallback = jest.fn(() => local);
    const apiFirst = new ApiFirstPublicationRepository(apiClient, fallback);

    await expect(apiFirst.reservePublication(reservation)).resolves.toMatchObject({ runId: reservation.runId });

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(local.reservePublication).toHaveBeenCalledWith(reservation);
  });

  it('does not turn an HTTP error into a local DB fallback', async () => {
    const fetcher = jest.fn(async () => new Response('{}', { status: 503 }));
    const apiClient = new KpiApiClient('https://nutria.example', 'token', 1000, fetcher);
    const local = repository();
    const fallback = jest.fn(() => local);
    const apiFirst = new ApiFirstPublicationRepository(apiClient, fallback);

    await expect(apiFirst.reservePublication(reservation)).rejects.toBeInstanceOf(KpiResponseError);

    expect(fallback).not.toHaveBeenCalled();
    expect(local.reservePublication).not.toHaveBeenCalled();
  });
});
