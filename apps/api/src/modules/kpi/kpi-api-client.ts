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
import type { SnapshotCut, SnapshotRun } from './snapshots/telemetry-snapshot.service';

export const KPI_API_REQUEST_TIMEOUT_MS = 15_000;

export interface KpiSampleRequest {
  scheduled_for: string;
  measured_at: string;
  api_ok: boolean | null;
  database_ok: boolean | null;
  reason: string | null;
  preview_date?: string;
}

export interface KpiSampleResponse {
  sample: { outcome: HealthSampleInput['outcome']; inserted: boolean; reason: string | null };
  preview: { executed: boolean; skip_reason: string | null; reused: boolean; results: readonly KpiResult[] };
  counts: { http_terminal: number; http_pending_incomplete: number; dependency_attempts: number; health_samples: number } | null;
  purge: { executed: boolean; cutoff: string | null; deleted: Record<string, number> | null };
}

export interface KpiFinalizeResponse extends SnapshotRun {
  cut: SnapshotCut;
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

  finalize(date: string, environment: string): Promise<KpiFinalizeResponse> {
    return this.post('/kpi/telemetry/finalize', { date, environment }, isFinalizeResponse);
  }

  collect(context: CollectionContext): Promise<readonly KpiResult[]> {
    return this.post('/kpi/collect', context, isKpiResults);
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

function isKpiResults(value: unknown): value is readonly KpiResult[] {
  return isKpiResultArray(value, ALL_KPI_IDS);
}

const ALL_KPI_IDS = [
  'operations_count', 'error_rate', 'latency_p95_ms', 'health_status',
  'last_success_age_seconds', 'timeout_rate', 'dependency_error_rate', 'availability_rate',
  'initial_plans_count', 'manual_recipes_count',
] as const;

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
  return context.contract_version === '1' && typeof context.run_id === 'string' &&
    typeof context.date === 'string' && typeof context.environment === 'string' &&
    typeof context.window_start === 'string' && typeof context.window_end === 'string' &&
    typeof value.payload_sha256 === 'string' && /^[0-9a-f]{64}$/i.test(value.payload_sha256);
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
  if (!isRecord(value) || !isRecord(value.sample) || !isRecord(value.preview) || !isRecord(value.purge)) return false;
  const { sample, preview, purge } = value;
  if (!['healthy', 'unhealthy', 'unknown'].includes(String(sample.outcome)) || typeof sample.inserted !== 'boolean' ||
    !(sample.reason === null || typeof sample.reason === 'string') || typeof preview.executed !== 'boolean' ||
    !(preview.skip_reason === null || typeof preview.skip_reason === 'string') || typeof preview.reused !== 'boolean') return false;
  if (preview.executed ? !isKpiResultArray(preview.results, TELEMETRY_KPI_IDS) : !Array.isArray(preview.results) || preview.results.length !== 0) return false;
  if (value.counts !== null && !isCountRecord(value.counts)) return false;
  return typeof purge.executed === 'boolean' && (purge.cutoff === null || typeof purge.cutoff === 'string') &&
    (purge.deleted === null || isCountRecord(purge.deleted));
}

function isFinalizeResponse(value: unknown): value is KpiFinalizeResponse {
  return isRecord(value) && isRecord(value.cut) && isTelemetryResults(value.results) &&
    typeof value.reused === 'boolean' && isSnapshotCut(value.cut) &&
    (value.aggregates === null || isRecord(value.aggregates));
}

const TELEMETRY_KPI_IDS = [
  'operations_count', 'error_rate', 'latency_p95_ms', 'health_status',
  'last_success_age_seconds', 'timeout_rate', 'dependency_error_rate', 'availability_rate',
] as const;

function isTelemetryResults(value: unknown): value is readonly KpiResult[] {
  return isKpiResultArray(value, TELEMETRY_KPI_IDS);
}

function isKpiResultArray(value: unknown, expectedIds: readonly string[]): value is readonly KpiResult[] {
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
  }
  return expectedIds.every(id => ids.has(id));
}

function isCountRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(item => Number.isInteger(item) && (item as number) >= 0);
}

function isSnapshotCut(value: Record<string, unknown>): boolean {
  return (value.environment === 'dev' || value.environment === 'qa' || value.environment === 'prod') &&
    typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
    typeof value.start === 'string' && Number.isFinite(Date.parse(value.start)) &&
    typeof value.end === 'string' && Number.isFinite(Date.parse(value.end));
}
