import { ALL_KPI_IDS as CURRENT_KPI_IDS, isAdherenceEvidence, LEGACY_KPI_IDS } from './kpi-contract';
import type { CollectionContext, KpiResult } from './kpi-contract';
import type { KpiLogger } from './kpi-contract';
import { canonicalPayloadBytes } from './kpi-batch';
import type { FrozenBatch } from './kpi-contract';
import type {
  PublicationRecord,
  PublicationRepository,
  PublicationReservation,
} from './publication-repository.port';
import type { HealthSampleInput } from './repo/telemetry.repository';

export const KPI_API_REQUEST_TIMEOUT_MS = 15_000;

export interface KpiSampleRequest {
  scheduled_for: string;
  measured_at: string;
  api_ok: boolean | null;
  database_ok: boolean | null;
  reason: string | null;
}

export interface KpiSampleResponse {
  sample: { outcome: HealthSampleInput['outcome']; inserted: boolean; reason: string | null };
  purge: { executed: boolean; cutoff: string | null; deleted: Record<string, number> | null };
}

export class KpiTransportError extends Error {
  constructor(readonly code: 'KPI_API_TIMEOUT' | 'KPI_API_NETWORK_ERROR') {
    super(code);
    this.name = 'KpiTransportError';
  }
}

export class KpiResponseError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = 'KpiResponseError';
  }
}

export class KpiApiClient implements PublicationRepository {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = KPI_API_REQUEST_TIMEOUT_MS,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  sample(request: KpiSampleRequest): Promise<KpiSampleResponse> {
    return this.post('/kpi/telemetry/sample', request, isSampleResponse);
  }

  collect(context: CollectionContext): Promise<readonly KpiResult[]> {
    return this.post('/kpi/collect', context, value => isKpiResults(value, context));
  }

  async reservePublication(reservation: PublicationReservation): Promise<PublicationRecord> {
    return this.postPublication('/kpi/publications/reserve', { reservation });
  }

  async getPublication(environment: PublicationReservation['environment'], date: string): Promise<PublicationRecord> {
    return this.postPublication('/kpi/publications/get', { environment, date });
  }

  async freezeBatchConditionally(
    runId: string,
    batch: FrozenBatch,
    payload: Buffer,
  ): Promise<{ won: boolean; publication: PublicationRecord }> {
    if (!payload.equals(canonicalPayloadBytes(batch.measurements))) {
      throw new TypeError('KPI_PUBLICATION_PAYLOAD_INVALID');
    }
    return this.post('/kpi/publications/freeze', { run_id: runId, batch }, isFreezeResponse)
      .then(result => ({ won: result.won, publication: decodePublicationRecord(result.publication) }));
  }

  claimAttempt(retryChainId: string, attempt: number): Promise<{ claimed: boolean }> {
    return this.post('/kpi/publications/claim-attempt', { retry_chain_id: retryChainId, attempt }, isClaimResponse);
  }

  async beginManualRecovery(input: {
    environment: PublicationReservation['environment'];
    date: string;
    runId: string;
    sourceCommit: string;
    retryChainId: string;
  }): Promise<PublicationRecord> {
    return this.postPublication('/kpi/publications/manual-recovery', {
      environment: input.environment,
      date: input.date,
      run_id: input.runId,
      source_commit: input.sourceCommit,
      retry_chain_id: input.retryChainId,
    });
  }

  async markAccepted(runId: string, acceptedAt: string): Promise<void> {
    await this.post('/kpi/publications/mark-accepted', { run_id: runId, accepted_at: acceptedAt }, isOkResponse);
  }

  async markDelivered(runId: string, deliveredAt: string): Promise<void> {
    await this.post('/kpi/publications/mark-delivered', { run_id: runId, delivered_at: deliveredAt }, isOkResponse);
  }

  async markFailed(runId: string, failureCode: string): Promise<void> {
    await this.post('/kpi/publications/mark-failed', { run_id: runId, failure_code: failureCode }, isOkResponse);
  }

  private async postPublication(path: string, body: unknown): Promise<PublicationRecord> {
    return decodePublicationRecord(await this.post(path, body, isPublicationRecordDto));
  }

  private async post<T>(path: string, body: unknown, validate: (value: unknown) => value is T): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new KpiTransportError('KPI_API_TIMEOUT'));
      }, this.timeoutMs);
    });
    try {
      const response = await Promise.race([
        this.fetcher(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }).catch(() => {
          throw new KpiTransportError(timedOut ? 'KPI_API_TIMEOUT' : 'KPI_API_NETWORK_ERROR');
        }),
        timeout,
      ]);

      if (!response.ok) throw new KpiResponseError(response.status, 'KPI_API_HTTP_ERROR');
      let payload: unknown;
      try {
        payload = await Promise.race([response.json(), timeout]);
      } catch (error) {
        if (timedOut) throw new KpiTransportError('KPI_API_TIMEOUT');
        if (error instanceof KpiTransportError) throw error;
        throw new KpiResponseError(response.status, 'KPI_API_INVALID_RESPONSE');
      }

      if (!validate(payload)) throw new KpiResponseError(response.status, 'KPI_API_INVALID_RESPONSE');
      return payload;
    } finally {
      clearTimeout(timer!);
    }
  }
}

/** Publication state is read/written through the backend first; Prisma fallback is lazy and transport-only. */
export class ApiFirstPublicationRepository implements PublicationRepository {
  constructor(
    private readonly api: PublicationRepository,
    private readonly fallback: () => PublicationRepository,
  ) {}

  reservePublication(reservation: PublicationReservation): Promise<PublicationRecord> {
    return this.withFallback(() => this.api.reservePublication(reservation), repo => repo.reservePublication(reservation));
  }

  getPublication(environment: PublicationReservation['environment'], date: string): Promise<PublicationRecord> {
    return this.withFallback(() => this.api.getPublication(environment, date), repo => repo.getPublication(environment, date));
  }

  freezeBatchConditionally(runId: string, batch: FrozenBatch, payload: Buffer) {
    return this.withFallback(
      () => this.api.freezeBatchConditionally(runId, batch, payload),
      repo => repo.freezeBatchConditionally(runId, batch, payload),
    );
  }

  claimAttempt(retryChainId: string, attempt: number): Promise<{ claimed: boolean }> {
    return this.withFallback(() => this.api.claimAttempt(retryChainId, attempt), repo => repo.claimAttempt(retryChainId, attempt));
  }

  beginManualRecovery(input: Parameters<PublicationRepository['beginManualRecovery']>[0]): Promise<PublicationRecord> {
    return this.withFallback(() => this.api.beginManualRecovery(input), repo => repo.beginManualRecovery(input));
  }

  markAccepted(runId: string, acceptedAt: string): Promise<void> {
    return this.withFallback(() => this.api.markAccepted(runId, acceptedAt), repo => repo.markAccepted(runId, acceptedAt));
  }

  markDelivered(runId: string, deliveredAt: string): Promise<void> {
    return this.withFallback(() => this.api.markDelivered(runId, deliveredAt), repo => repo.markDelivered(runId, deliveredAt));
  }

  markFailed(runId: string, failureCode: string): Promise<void> {
    return this.withFallback(() => this.api.markFailed(runId, failureCode), repo => repo.markFailed(runId, failureCode));
  }

  private async withFallback<T>(
    request: () => Promise<T>,
    fallback: (repository: PublicationRepository) => Promise<T>,
  ): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (!(error instanceof KpiTransportError)) throw error;
      return fallback(this.fallback());
    }
  }
}

/** Uses API collection first and permits direct source access only after a transport failure. */
export class ApiFirstKpiLogger implements KpiLogger {
  constructor(private readonly api: KpiApiClient, private readonly fallback: KpiLogger) {}

  async collect(context: CollectionContext): Promise<readonly KpiResult[]> {
    try {
      return await this.api.collect(context);
    } catch (error) {
      if (!(error instanceof KpiTransportError)) throw error;
      return this.fallback.collect(context);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isKpiResults(value: unknown, context: CollectionContext): value is readonly KpiResult[] {
  return isKpiResultArray(value, CURRENT_KPI_IDS, context.environment);
}

type PublicationRecordDto = Omit<PublicationRecord, 'frozenPayload'>;

function isPublicationRecordDto(value: unknown): value is PublicationRecordDto {
  if (!isRecord(value)) return false;
  return typeof value.runId === 'string' && typeof value.date === 'string' &&
    (value.environment === 'dev' || value.environment === 'qa' || value.environment === 'prod') &&
    typeof value.sourceCommit === 'string' && typeof value.retryChainId === 'string' &&
    ['preparing', 'frozen', 'accepted', 'delivered', 'failed'].includes(String(value.status)) &&
    (value.frozenBatch === null || isFrozenBatch(value.frozenBatch)) &&
    (value.payloadSha256 === null || (typeof value.payloadSha256 === 'string' && /^[0-9a-f]{64}$/i.test(value.payloadSha256))) &&
    (value.acceptedAt === null || typeof value.acceptedAt === 'string') &&
    (value.deliveredAt === null || typeof value.deliveredAt === 'string') &&
    (value.failureCode === null || typeof value.failureCode === 'string') &&
    Number.isInteger(value.attemptCount) && (value.attemptCount as number) >= 0 && (value.attemptCount as number) <= 3;
}

function isFrozenBatch(value: unknown): value is FrozenBatch {
  if (!isRecord(value) || value.contract_version !== '1' || !isRecord(value.context) ||
    !Array.isArray(value.measurements) || !Array.isArray(value.diagnostics)) return false;
  const context = value.context;
  if (context.contract_version !== '1' || typeof context.run_id !== 'string' ||
    typeof context.date !== 'string' || typeof context.environment !== 'string' ||
    typeof context.window_start !== 'string' || typeof context.window_end !== 'string' ||
    typeof value.payload_sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(value.payload_sha256)) return false;

  const measurementIds = new Set(value.measurements.filter(isRecord).map(item => item.kpi_id).filter((id): id is string => typeof id === 'string'));
  const diagnosticIds = new Set(value.diagnostics.filter(isRecord).map(item => item.kpi_id).filter((id): id is string => typeof id === 'string'));
  const expectedIds = hasExactSet(measurementIds, CURRENT_KPI_IDS)
    ? CURRENT_KPI_IDS
    : hasExactSet(measurementIds, LEGACY_KPI_IDS) ? LEGACY_KPI_IDS : null;
  if (!expectedIds || !hasExactSet(diagnosticIds, expectedIds) || value.measurements.length !== expectedIds.length ||
    value.diagnostics.length !== expectedIds.length) return false;

  for (const measurement of value.measurements) {
    if (!isRecord(measurement) || typeof measurement.kpi_id !== 'string' || !expectedIds.includes(measurement.kpi_id as never) ||
      measurement.date !== context.date || measurement.env !== context.environment || measurement.run_id !== context.run_id ||
      typeof measurement.value !== 'number' || !Number.isFinite(measurement.value)) return false;
  }
  for (const diagnostic of value.diagnostics) {
    if (!isRecord(diagnostic) || typeof diagnostic.kpi_id !== 'string' || !expectedIds.includes(diagnostic.kpi_id as never) ||
      (diagnostic.quality !== 'observed' && diagnostic.quality !== 'defaulted') ||
      !(diagnostic.reason === null || typeof diagnostic.reason === 'string') ||
      !Number.isSafeInteger(diagnostic.sample_count) || (diagnostic.sample_count as number) < 0) return false;
    if (diagnostic.kpi_id === 'adherence_rate') {
      if (!isAdherenceEvidence(diagnostic.evidence) || diagnostic.evidence.environment !== context.environment ||
        diagnostic.sample_count !== (diagnostic.evidence.denominator ?? 0) ||
        diagnostic.reason !== diagnostic.evidence.reason ||
        diagnostic.quality !== (diagnostic.evidence.quality === 'unavailable' ? 'defaulted' : 'observed') ||
        value.measurements.find(item => isRecord(item) && item.kpi_id === 'adherence_rate')?.value !==
          (diagnostic.evidence.quality === 'observed'
            ? (100 * diagnostic.evidence.numerator!) / diagnostic.evidence.denominator!
            : 0)) return false;
    } else if (diagnostic.evidence !== undefined) return false;
  }
  return true;
}

function decodePublicationRecord(value: PublicationRecordDto): PublicationRecord {
  return {
    ...value,
    frozenPayload: value.frozenBatch ? canonicalPayloadBytes(value.frozenBatch.measurements) : null,
  };
}

function isFreezeResponse(value: unknown): value is { won: boolean; publication: PublicationRecordDto } {
  return isRecord(value) && typeof value.won === 'boolean' && isPublicationRecordDto(value.publication);
}

function isClaimResponse(value: unknown): value is { claimed: boolean } {
  return isRecord(value) && typeof value.claimed === 'boolean';
}

function isOkResponse(value: unknown): value is { ok: true } {
  return isRecord(value) && value.ok === true;
}

function isSampleResponse(value: unknown): value is KpiSampleResponse {
  if (!isRecord(value) || !isRecord(value.sample) || !isRecord(value.purge)) return false;
  const { sample, purge } = value;
  if (!['healthy', 'unhealthy', 'unknown'].includes(String(sample.outcome)) || typeof sample.inserted !== 'boolean' ||
    !(sample.reason === null || typeof sample.reason === 'string')) return false;
  return typeof purge.executed === 'boolean' && (purge.cutoff === null || typeof purge.cutoff === 'string') &&
    (purge.deleted === null || isCountRecord(purge.deleted));
}

function isKpiResultArray(
  value: unknown,
  expectedIds: readonly string[],
  environment?: CollectionContext['environment'],
): value is readonly KpiResult[] {
  if (!Array.isArray(value) || value.length !== expectedIds.length) return false;
  const ids = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.kpi_id !== 'string' || !expectedIds.includes(item.kpi_id) || ids.has(item.kpi_id)) return false;
    ids.add(item.kpi_id);
    if (item.quality === 'observed') {
      if (typeof item.value !== 'number' || !Number.isFinite(item.value) || item.reason !== null) return false;
    } else if (item.quality !== 'unavailable' || item.value !== null || typeof item.reason !== 'string' || !item.reason) {
      return false;
    }
    if (!Number.isInteger(item.sample_count) || (item.sample_count as number) < 0) return false;
    if (typeof item.measured_at !== 'string' || !Number.isFinite(Date.parse(item.measured_at))) return false;
    if (item.kpi_id === 'adherence_rate') {
      if (!isAdherenceEvidence(item.evidence) || item.sample_count !== (item.evidence.denominator ?? 0) ||
        item.quality !== item.evidence.quality || item.reason !== item.evidence.reason ||
        (environment !== undefined && item.evidence.environment !== environment) || item.evidence.measured_at !== item.measured_at ||
        (item.evidence.quality === 'observed' && item.value !== (100 * item.evidence.numerator!) / item.evidence.denominator!) ||
        (item.evidence.quality === 'unavailable' && item.value !== null)) return false;
    } else if (item.evidence !== undefined) return false;
  }
  return expectedIds.every(id => ids.has(id));
}

function isCountRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(item => Number.isInteger(item) && (item as number) >= 0);
}

function hasExactSet(actual: ReadonlySet<string>, expected: readonly string[]): boolean {
  return actual.size === expected.length && expected.every(id => actual.has(id));
}

