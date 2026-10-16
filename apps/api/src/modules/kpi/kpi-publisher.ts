import { createHash } from 'node:crypto';

import { freezeBatch } from './kpi-batch';
import type { CollectionContext, KpiEnvironment, KpiLogger, Measurement } from './kpi-contract';
import { buildPublicationArtifacts } from './kpi-artifacts';
import { resolveArgentinaKpiWindow, type Clock } from './kpi-window';
import type { PublicationRecord, PublicationRepository } from './publication-repository.port';

export class StructuralKpiError extends Error {}

export function classifyPublicationError(error: unknown): { retryable: boolean } {
  if (error instanceof StructuralKpiError) return { retryable: false };
  if (isRecord(error) && (error.code === 'REMOTE_VALUE_CONFLICT' || error.code === 'CATALOG_CONFLICT')) return { retryable: false };
  if (isRecord(error) && error.kind === 'retryable') return { retryable: true };
  if (isRecord(error) && error.kind === 'definitive') return { retryable: false };
  if (isRecord(error) && (error.kind === 'network' || error.kind === 'timeout')) return { retryable: true };
  const status = isRecord(error) && typeof error.status === 'number' ? error.status : undefined;
  return { retryable: status === 408 || status === 429 || (status !== undefined && status >= 500) };
}

export function parseRetryAfter(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, timestamp - now.getTime());
}

export type RemotePost =
  | { kind: 'accepted'; status: number }
  | { kind: 'definitive'; status: number | null; retryAfterMs?: number | null; errorKind?: 'network' | 'timeout' }
  | { kind: 'retryable'; status: number | null; retryAfterMs?: number | null; errorKind?: 'network' | 'timeout' };

/** The remote GET result must distinguish absence from an indeterminate read. */
export type RemoteVerification =
  | { kind: 'match'; status: number }
  | { kind: 'not_found'; status: number }
  | { kind: 'conflict'; status: number }
  | { kind: 'unavailable'; status: number | null };

export interface KpiRemoteClient {
  post(payload: Buffer): Promise<RemotePost>;
  /** A remote read needs the frozen projection to distinguish MATCH from conflict. */
  verify(environment: KpiEnvironment, date: string, expected: readonly Measurement[]): Promise<RemoteVerification>;
}

export interface KpiPublisherDependencies {
  repository: PublicationRepository;
  logger: KpiLogger;
  remoteClient: KpiRemoteClient;
  artifactWriter: { write(artifacts: Record<string, Buffer>): Promise<void> };
  clock: Clock;
  idGenerator: { next(): string };
}

export interface PublishRequest {
  environment: KpiEnvironment;
  date: string;
  sourceCommit: string;
  retryChainId: string;
  attempt: number;
  runId?: string;
  manualRecovery?: boolean;
}

export interface PublishResult {
  status: string;
  postAccepted: boolean;
  failureCode?: string;
  retryable?: boolean;
  retryAfterMs?: number | null;
  httpStatus?: number | null;
}

/** Coordinates ports only: no database, network, or credential implementation lives here. */
export class KpiPublisher {
  constructor(private readonly dependencies: KpiPublisherDependencies) {}

  async publish(request: PublishRequest): Promise<PublishResult> {
    // Validate the immutable local cut before reserving any durable state.
    const window = resolveArgentinaKpiWindow(request.date, this.dependencies.clock);
    let publication = await this.dependencies.repository.reservePublication({
      environment: request.environment,
      date: request.date,
      runId: this.dependencies.idGenerator.next(),
      sourceCommit: request.sourceCommit,
      retryChainId: request.retryChainId,
    });

    if (request.runId && publication.runId !== request.runId) throw new StructuralKpiError('KPI_RUN_ID_MISMATCH');
    if (request.attempt > 0 && publication.sourceCommit !== request.sourceCommit) {
      throw new StructuralKpiError('KPI_SOURCE_COMMIT_MISMATCH');
    }
    if (request.manualRecovery) {
      publication = await this.dependencies.repository.beginManualRecovery({
        environment: request.environment,
        date: request.date,
        runId: publication.runId,
        sourceCommit: request.sourceCommit,
        retryChainId: request.retryChainId,
      });
    } else if (request.attempt > 0 && publication.retryChainId !== request.retryChainId) {
      throw new StructuralKpiError('KPI_RETRY_CHAIN_MISMATCH');
    }

    if (publication.status === 'delivered') {
      return { status: 'delivered', postAccepted: true, httpStatus: null };
    }
    if (publication.status === 'accepted' || publication.acceptedAt) {
      return this.verifyAcceptedPublication(publication, request);
    }

    // The reservation itself owns initial attempt zero. Retries use the same
    // durable publication row as an atomic compare-and-set claim.
    if (request.attempt === 1 || request.attempt === 2) {
      if (!(await this.dependencies.repository.claimAttempt(request.retryChainId, request.attempt)).claimed) {
        return { status: 'skipped_duplicate', postAccepted: false, httpStatus: null };
      }
    }

    let recoveredFrozenBatch = publication.frozenBatch !== null;
    if (!publication.frozenBatch) {
      const context: CollectionContext = { contract_version: '1', ...window, environment: request.environment, run_id: publication.runId };
      const batch = freezeBatch(context, await this.dependencies.logger.collect(context));
      const freeze = await this.dependencies.repository.freezeBatchConditionally(publication.runId, batch, Buffer.from(JSON.stringify(batch.measurements), 'utf8'));
      publication = freeze.publication;
      // A losing CAS means another execution already owned this frozen batch
      // and might already have reached a successful POST.
      recoveredFrozenBatch = !freeze.won;
    }

    if (!hasValidFrozenPayload(publication)) {
      await this.dependencies.repository.markFailed(publication.runId, 'BATCH_INTEGRITY_ERROR');
      return { status: 'failed', postAccepted: false, failureCode: 'BATCH_INTEGRITY_ERROR', httpStatus: null };
    }

    if (recoveredFrozenBatch) {
      const verification = await this.verifyRemotely(publication);
      if (verification.kind === 'match') {
        return this.reconcileRemoteMatch(publication, request, verification.status);
      }
      if (verification.kind === 'conflict') {
        await this.dependencies.repository.markFailed(publication.runId, 'REMOTE_VALUE_CONFLICT');
        await this.writeArtifacts(publication, request, false, 'failed', 'REMOTE_VALUE_CONFLICT', verification.status, false);
        return { status: 'failed', postAccepted: false, failureCode: 'REMOTE_VALUE_CONFLICT', httpStatus: verification.status };
      }
      if (verification.kind === 'unavailable') {
        await this.writeArtifacts(publication, request, false, 'verify_pending', null, verification.status, true);
        return { status: 'verify_pending', postAccepted: false, retryable: true, httpStatus: verification.status };
      }
      // Only a typed NOT_FOUND permits a first (or retried) POST.
    }

    let response: RemotePost;
    try {
      response = await this.dependencies.remoteClient.post(publication.frozenPayload);
    } catch (error) {
      const classification = classifyPublicationError(error);
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : null;
      await this.dependencies.repository.markFailed(publication.runId, 'REMOTE_POST_ERROR');
      await this.writeArtifacts(publication, request, false, 'failed', 'REMOTE_POST_ERROR', status, classification.retryable);
      return { status: 'failed', postAccepted: false, failureCode: 'REMOTE_POST_ERROR', retryable: classification.retryable, httpStatus: status };
    }
    if (response.kind !== 'accepted' || response.status < 200 || response.status >= 300) {
      const failureCode = 'REMOTE_POST_ERROR';
      await this.dependencies.repository.markFailed(publication.runId, failureCode);
      const classification = classifyPublicationError(response);
      const retryAfterMs = response.kind !== 'accepted' ? response.retryAfterMs ?? null : null;
      await this.writeArtifacts(publication, request, false, 'failed', failureCode, response.status, classification.retryable, retryAfterMs);
      return { status: 'failed', postAccepted: false, failureCode, retryable: classification.retryable, retryAfterMs, httpStatus: response.status };
    }

    const acceptedAt = this.dependencies.clock.now().toISOString();
    try {
      await this.dependencies.repository.markAccepted(publication.runId, acceptedAt);
    } catch {
      await this.writeArtifacts(publication, request, true, 'verify_pending', null, response.status, false);
      return { status: 'verify_pending', postAccepted: true, httpStatus: response.status };
    }

    const verification = await this.verifyRemotely(publication);
    if (verification.kind === 'match') {
      return this.reconcileRemoteMatch(publication, request, verification.status);
    }
    if (verification.kind === 'conflict') {
      await this.recordAcceptedConflict(publication, request, verification.status);
      return { status: 'failed', postAccepted: true, failureCode: 'REMOTE_VALUE_CONFLICT', httpStatus: verification.status };
    }
    await this.writeArtifacts(publication, request, true, 'verify_pending', null, verification.status, false);
    return { status: 'verify_pending', postAccepted: true, httpStatus: verification.status };
  }

  private async verifyAcceptedPublication(
    publication: PublicationRecord,
    request: PublishRequest,
  ): Promise<PublishResult> {
    if (!hasValidFrozenPayload(publication)) {
      await this.writeArtifacts(publication, request, true, 'failed', 'BATCH_INTEGRITY_ERROR', null, false);
      return { status: 'failed', postAccepted: true, failureCode: 'BATCH_INTEGRITY_ERROR', httpStatus: null };
    }
    const verification = await this.verifyRemotely(publication);
    if (verification.kind === 'match') return this.reconcileRemoteMatch(publication, request, verification.status);
    if (verification.kind === 'conflict') {
      await this.recordAcceptedConflict(publication, request, verification.status);
      return { status: 'failed', postAccepted: true, failureCode: 'REMOTE_VALUE_CONFLICT', httpStatus: verification.status };
    }
    await this.writeArtifacts(publication, request, true, 'verify_pending', null, verification.status, false);
    return { status: 'verify_pending', postAccepted: true, httpStatus: verification.status };
  }

  private async recordAcceptedConflict(
    publication: PublicationRecord,
    request: PublishRequest,
    httpStatus: number,
  ): Promise<void> {
    try {
      await this.dependencies.repository.markFailed(publication.runId, 'REMOTE_VALUE_CONFLICT');
    } catch {
      // The accepted POST is authoritative for retry suppression even if this diagnostic state write fails.
    }
    await this.writeArtifacts(publication, request, true, 'failed', 'REMOTE_VALUE_CONFLICT', httpStatus, false);
  }

  private async reconcileRemoteMatch(
    publication: PublicationRecord,
    request: PublishRequest,
    httpStatus: number,
  ): Promise<PublishResult> {
    try {
      if (!publication.acceptedAt) {
        await this.dependencies.repository.markAccepted(publication.runId, this.dependencies.clock.now().toISOString());
      }
      await this.dependencies.repository.markDelivered(publication.runId, this.dependencies.clock.now().toISOString());
    } catch {
      await this.writeArtifacts(publication, request, true, 'verify_pending', null, httpStatus, false);
      return { status: 'verify_pending', postAccepted: true, httpStatus };
    }
    await this.writeArtifacts(publication, request, true, 'delivered', null, httpStatus, false);
    return { status: 'delivered', postAccepted: true, httpStatus };
  }

  private async verifyRemotely(publication: PublicationRecord & { frozenBatch: NonNullable<PublicationRecord['frozenBatch']> }): Promise<RemoteVerification> {
    try {
      return await this.dependencies.remoteClient.verify(publication.environment, publication.date, publication.frozenBatch.measurements);
    } catch {
      // A failed GET cannot prove non-existence after an earlier POST.
      return { kind: 'unavailable', status: null };
    }
  }

  private async writeArtifacts(
    publication: PublicationRecord,
    request: PublishRequest,
    postAccepted: boolean,
    status: string,
    failureCode: string | null,
    httpStatus: number | null,
    retryable: boolean,
    retryAfterMs: number | null = null,
  ): Promise<void> {
    if (!publication.frozenPayload || !publication.frozenBatch || !publication.payloadSha256) return;
    try {
      await this.dependencies.artifactWriter.write(buildPublicationArtifacts({
        frozenPayload: publication.frozenPayload, runId: publication.runId, date: publication.date,
        environment: publication.environment, payloadSha256: publication.payloadSha256,
        windowStart: publication.frozenBatch.context.window_start,
        windowEnd: publication.frozenBatch.context.window_end,
        diagnostics: publication.frozenBatch.diagnostics, postAccepted, status, failureCode,
        retry: { retryChainId: publication.retryChainId, attempt: request.attempt }, httpStatus, retryable, retryAfterMs,
      }));
    } catch {
      // Evidence I/O is best effort.  It must never turn an acknowledged POST
      // into an apparent pre-POST failure that could schedule a duplicate.
    }
  }
}

function hasValidFrozenPayload(publication: PublicationRecord): publication is PublicationRecord & { frozenPayload: Buffer; payloadSha256: string; frozenBatch: NonNullable<PublicationRecord['frozenBatch']> } {
  if (!publication.frozenPayload || !publication.payloadSha256 || !publication.frozenBatch) return false;
  return createHash('sha256').update(publication.frozenPayload).digest('hex') === publication.payloadSha256;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
