import { createHash } from 'node:crypto';

import { canonicalPayloadBytes, freezeBatch } from './kpi-batch';
import type { CollectionContext, KpiEnvironment, KpiLogger, Measurement } from './kpi-contract';
import { buildPublicationArtifacts } from './kpi-artifacts';
import { KPI_IDS } from './kpi-catalog';
import { KpiPublicationNotFoundError } from './publication-repository.port';
import type { PublicationRecord, PublicationRepository } from './publication-repository.port';
import { resolveArgentinaKpiWindow, type Clock } from './kpi-window';

export class StructuralKpiError extends Error {}
export class KpiArtifactPersistenceError extends Error {
  constructor() {
    super('KPI_ARTIFACT_PERSISTENCE_FAILED');
    this.name = 'KpiArtifactPersistenceError';
  }
}

export function classifyPublicationError(error: unknown): { retryable: boolean } {
  if (error instanceof StructuralKpiError || error instanceof KpiArtifactPersistenceError) return { retryable: false };
  if (isRecord(error) && (error.code === 'REMOTE_VALUE_CONFLICT' || error.code === 'CATALOG_CONFLICT')) return { retryable: false };
  if (isRecord(error) && error.kind === 'retryable') return { retryable: true };
  if (isRecord(error) && error.kind === 'definitive') return { retryable: false };
  if (isRecord(error) && (error.kind === 'network' || error.kind === 'timeout')) return { retryable: true };
  if (isRecord(error) && typeof error.code === 'string' && /^P10(01|02|08|17|24)$/.test(error.code)) return { retryable: true };
  const status = isRecord(error) && typeof error.status === 'number' ? error.status : undefined;
  return { retryable: status === 408 || status === 429 || (status !== undefined && status >= 500) };
}

export function parseRetryAfter(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const milliseconds = BigInt(value) * 1000n;
    const maximum = BigInt(Number.MAX_SAFE_INTEGER);
    return Number(milliseconds > maximum ? maximum : milliseconds);
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, timestamp - now.getTime()));
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
  | {
      kind: 'unavailable';
      status: number | null;
      retryable?: boolean;
      retryAfterMs?: number | null;
      errorKind?: 'network' | 'timeout';
    };

export interface KpiRemoteClient {
  post(payload: Buffer): Promise<RemotePost>;
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
  /** Required for retries when available, but the durable environment/date row is authoritative. */
  runId?: string;
  /** GitHub Actions uses a prepare/upload/post split so remote POST cannot precede artifact upload. */
  phase?: 'prepare-only' | 'post-frozen';
  artifactUploadConfirmed?: boolean;
  manualRecovery?: boolean;
}

export interface PublishOutcome {
  status: string;
  postAccepted: boolean;
  failureCode?: string;
  retryable?: boolean;
  retryAfterMs?: number | null;
  runId?: string;
  retryChainId?: string;
}

type PrepareResult =
  | { kind: 'prepared'; publication: PublicationRecord; request: PublishRequest; collectedNow: boolean }
  | { kind: 'terminal'; request: PublishRequest; outcome: PublishOutcome };

/** Coordinates ports only: no database, network, or credential implementation lives here. */
export class KpiPublisher {
  constructor(private readonly dependencies: KpiPublisherDependencies) {}

  async publish(request: PublishRequest): Promise<PublishOutcome> {
    if (request.phase === 'post-frozen') return this.postFrozen(request);
    return this.prepare(request);
  }

  /** Reserves/recovers and freezes locally. This operation never sends a POST. */
  async prepare(request: PublishRequest): Promise<PublishOutcome> {
    if (!isAllowedAttempt(request.attempt)) return outcome('skipped_duplicate', false);
    const prepared = await this.prepareBatch(request);
    if (prepared.kind === 'terminal') return prepared.outcome;
    return this.withIdentity(outcome('prepared', false), prepared);
  }

  private async prepareBatch(request: PublishRequest): Promise<PrepareResult> {
    // Validate/calculate the window before any reservation can be created.
    const window = resolveArgentinaKpiWindow(request.date, this.dependencies.clock);
    let publication: PublicationRecord;
    if (request.manualRecovery) {
      if (!request.runId || !this.dependencies.repository.recoverManually) {
        return { kind: 'terminal', request, outcome: outcome('failed', false, 'KPI_MANUAL_RECOVERY_NOT_ELIGIBLE') };
      }
      try {
        publication = await this.dependencies.repository.recoverManually(request.runId, request.retryChainId);
      } catch {
        return { kind: 'terminal', request, outcome: outcome('failed', false, 'KPI_MANUAL_RECOVERY_NOT_ELIGIBLE') };
      }
    } else if (request.attempt === 0) {
      publication = await this.dependencies.repository.reservePublication({
        environment: request.environment,
        date: request.date,
        runId: this.dependencies.idGenerator.next(),
        sourceCommit: request.sourceCommit,
        retryChainId: request.retryChainId,
        windowStart: window.window_start,
        windowEnd: window.window_end,
      });
    } else {
      try {
        publication = await this.dependencies.repository.getPublication(request.environment, request.date);
      } catch (error) {
        if (!(error instanceof KpiPublicationNotFoundError)) throw error;
        // A first attempt may have failed before it could persist its reservation.
        // Seed the durable counter with the already completed executions in this chain.
        publication = await this.dependencies.repository.reservePublication({
          environment: request.environment,
          date: request.date,
          runId: this.dependencies.idGenerator.next(),
          sourceCommit: request.sourceCommit,
          retryChainId: request.retryChainId,
          windowStart: window.window_start,
          windowEnd: window.window_end,
          priorAttemptCount: request.attempt as 1 | 2,
        });
      }
    }

    const effectiveRequest = { ...request, retryChainId: publication.retryChainId, runId: publication.runId };
    if (request.attempt !== 0 && (publication.retryChainId !== request.retryChainId ||
      publication.sourceCommit !== request.sourceCommit || (request.runId && publication.runId !== request.runId))) {
      return { kind: 'terminal', request: effectiveRequest, outcome: this.withIdentity(outcome('skipped_duplicate', false), { publication, request: effectiveRequest, collectedNow: false }) };
    }
    if (request.manualRecovery && (publication.retryChainId !== request.retryChainId || publication.sourceCommit !== request.sourceCommit)) {
      return { kind: 'terminal', request: effectiveRequest, outcome: outcome('failed', false, 'KPI_MANUAL_RECOVERY_NOT_ELIGIBLE') };
    }

    if (publication.acceptedAt || publication.status === 'accepted' || publication.status === 'delivered' || publication.deliveredAt) {
      if (hasValidFrozenPayload(publication)) {
        await this.persistArtifacts(publication, effectiveRequest, true,
          publication.status === 'delivered' || publication.deliveredAt ? 'delivered' : 'accepted', null, null, false);
      }
      return { kind: 'terminal', request: effectiveRequest, outcome: this.withIdentity(outcome(
        publication.deliveredAt || publication.status === 'delivered' ? 'delivered' : 'verify_pending', true,
      ), { publication, request: effectiveRequest, collectedNow: false }) };
    }

    // Any durable fragment of a freeze is immutable evidence: if the batch,
    // byte projection, or digest is partial/corrupt, never recollect over it.
    if (hasFrozenPayloadMaterial(publication) && !hasValidFrozenPayload(publication)) {
      await this.dependencies.repository.markFailed(publication.runId, 'BATCH_INTEGRITY_ERROR');
      return { kind: 'terminal', request: effectiveRequest, outcome: this.withIdentity(
        outcome('failed', false, 'BATCH_INTEGRITY_ERROR'), { publication, request: effectiveRequest, collectedNow: false },
      ) };
    }

    // A retry preparation owns its attempt CAS before it can freeze/upload the
    // batch. Catch up only missing prior executions, then claim this retry.
    // This makes a restart during prepare recoverable without another collector
    // run when a frozen batch already exists.
    if (request.attempt > 0) {
      // A repeated prepare for the currently claimed retry is allowed to
      // re-upload the same durable frozen payload (for example, if a prior
      // Actions artifact upload failed). It must not claim another number.
      // A newer count means this dispatch is stale/duplicated.
      if (publication.attemptCount > request.attempt + 1) {
        return { kind: 'terminal', request: effectiveRequest, outcome: this.withIdentity(
          outcome('skipped_duplicate', false), { publication, request: effectiveRequest, collectedNow: false },
        ) };
      }
      while (publication.attemptCount <= request.attempt) {
        const claim = {
          environment: publication.environment,
          date: publication.date,
          runId: publication.runId,
          retryChainId: request.retryChainId,
          attempt: publication.attemptCount as 0 | 1 | 2,
        };
        if (!(await this.dependencies.repository.claimAttempt(claim)).claimed) {
          return { kind: 'terminal', request: effectiveRequest, outcome: this.withIdentity(
            outcome('skipped_duplicate', false), { publication, request: effectiveRequest, collectedNow: false },
          ) };
        }
        publication = await this.dependencies.repository.getPublication(request.environment, request.date);
        if (publication.retryChainId !== request.retryChainId || publication.runId !== effectiveRequest.runId ||
          publication.sourceCommit !== request.sourceCommit) {
          return { kind: 'terminal', request: effectiveRequest, outcome: this.withIdentity(
            outcome('failed', false, 'KPI_PUBLICATION_IDENTITY_MISMATCH'), { publication, request: effectiveRequest, collectedNow: false },
          ) };
        }
      }
    }

    let collectedNow = false;
    if (!hasFrozenPayloadMaterial(publication)) {
      const context: CollectionContext = {
        contract_version: '1', ...window, environment: request.environment, run_id: publication.runId,
      };
      const batch = freezeBatch(context, await this.dependencies.logger.collect(context));
      const payload = canonicalPayloadBytes(batch.measurements);
      const freeze = await this.dependencies.repository.freezeBatchConditionally(
        publication.runId, batch, payload, { keepPreparing: request.attempt > 0 },
      );
      publication = freeze.publication;
      if (!freeze.won) {
        return { kind: 'terminal', request: effectiveRequest, outcome: this.withIdentity(outcome('verify_pending', false), { publication, request: effectiveRequest, collectedNow: false }) };
      }
      collectedNow = true;
    }

    if (!hasValidFrozenPayload(publication)) {
      await this.dependencies.repository.markFailed(publication.runId, 'BATCH_INTEGRITY_ERROR');
      return { kind: 'terminal', request: effectiveRequest, outcome: this.withIdentity(outcome('failed', false, 'BATCH_INTEGRITY_ERROR'), { publication, request: effectiveRequest, collectedNow: false }) };
    }

    // This is the local durable artifact phase. In Actions, the prepare-only
    // invocation then uploads these exact bytes before the post-frozen phase.
    await this.persistArtifacts(publication, effectiveRequest, false, 'frozen', null, null, false);
    return { kind: 'prepared', publication, request: effectiveRequest, collectedNow };
  }

  /** Sends a previously frozen row. The CLI requires the Actions upload gate before calling this. */
  async postFrozen(request: PublishRequest): Promise<PublishOutcome> {
    let publication: PublicationRecord;
    try {
      publication = await this.dependencies.repository.getPublication(request.environment, request.date);
    } catch (error) {
      const classification = classifyPublicationError(error);
      const notFound = error instanceof KpiPublicationNotFoundError;
      return {
        ...outcome('failed', false, notFound ? 'KPI_PUBLICATION_NOT_FOUND' : 'KPI_PUBLICATION_READ_FAILED'),
        retryable: notFound ? false : classification.retryable,
        retryAfterMs: getRetryAfterMs(error),
        ...(request.runId ? { runId: request.runId } : {}),
        retryChainId: request.retryChainId,
      };
    }
    const effectiveRequest = { ...request, runId: publication.runId };
    if (publication.retryChainId !== request.retryChainId ||
      publication.sourceCommit !== request.sourceCommit || (request.runId && request.runId !== publication.runId)) {
      return this.withIdentity(outcome('failed', false, 'KPI_PUBLICATION_IDENTITY_MISMATCH'), { publication, request: effectiveRequest, collectedNow: false });
    }
    if (publication.acceptedAt || publication.status === 'accepted' || publication.status === 'delivered' || publication.deliveredAt) {
      if (publication.deliveredAt || publication.status === 'delivered') {
        return this.withIdentity(outcome('delivered', true), { publication, request: effectiveRequest, collectedNow: false });
      }
      if (!hasValidFrozenPayload(publication)) return this.withIdentity(outcome('verify_pending', true), { publication, request: effectiveRequest, collectedNow: false });
      return this.reconcileAccepted(publication, effectiveRequest);
    }
    return this.sendFrozen(publication, effectiveRequest);
  }

  private async sendFrozen(publication: PublicationRecord, request: PublishRequest): Promise<PublishOutcome> {
    if (publication.acceptedAt || publication.status === 'accepted' || publication.status === 'delivered' || publication.deliveredAt) {
      if (publication.deliveredAt || publication.status === 'delivered') {
        return this.withIdentity(outcome('delivered', true), { publication, request, collectedNow: false });
      }
      return this.reconcileAccepted(publication, request);
    }
    if (!hasValidFrozenPayload(publication)) {
      await this.dependencies.repository.markFailed(publication.runId, 'BATCH_INTEGRITY_ERROR');
      return this.withIdentity(outcome('failed', false, 'BATCH_INTEGRITY_ERROR'), { publication, request, collectedNow: false });
    }

    // A duplicate initial dispatch can arrive after attempt zero was already
    // claimed by a process that exited before persisting accepted_at. It may
    // perform read-only reconciliation, but can never reclaim/post attempt 0.
    if (request.attempt === 0 && publication.attemptCount > 0) {
      const verification = await this.verifyRemotely(publication);
      if (verification.kind === 'match') return this.reconcileMatch(publication, request, verification.status);
      if (verification.kind === 'conflict') {
        await this.dependencies.repository.markFailed(publication.runId, 'REMOTE_VALUE_CONFLICT');
        await this.persistArtifactsBestEffort(publication, request, false, 'failed', 'REMOTE_VALUE_CONFLICT', verification.status, false);
        return this.withIdentity(outcome('failed', false, 'REMOTE_VALUE_CONFLICT'), { publication, request, collectedNow: false });
      }
      if (verification.kind === 'unavailable') {
        const retryable = verification.retryable ?? true;
        await this.persistArtifactsBestEffort(publication, request, false, 'verify_pending', null, verification.status, retryable, verification.retryAfterMs);
        return this.withIdentity({
          ...outcome('verify_pending', false), retryable, retryAfterMs: verification.retryAfterMs ?? null,
        }, { publication, request, collectedNow: false });
      }
      return this.withIdentity(outcome('skipped_duplicate', false), { publication, request, collectedNow: false });
    }

    let attemptPublication: PublicationRecord = publication;
    // Initial publication claims only after its Actions artifact upload gate.
    // Retries claimed during prepare-only so a crash before freeze can still
    // advance safely; the next CAS below is the exclusive HTTP-phase gate.
    if (!isAllowedAttempt(request.attempt)) {
      return this.withIdentity(outcome('skipped_duplicate', false), { publication, request, collectedNow: false });
    }
    if (request.attempt === 0) {
      const claimed = await this.dependencies.repository.claimAttempt({
        environment: publication.environment,
        date: publication.date,
        runId: publication.runId,
        retryChainId: request.retryChainId,
        attempt: request.attempt,
      });
      if (!claimed.claimed) {
        return this.withIdentity(outcome('skipped_duplicate', false), { publication, request, collectedNow: false });
      }
      attemptPublication = await this.dependencies.repository.getPublication(request.environment, request.date);
    } else if (publication.attemptCount !== request.attempt + 1 || publication.status !== 'preparing') {
      return this.withIdentity(outcome('skipped_duplicate', false), { publication, request, collectedNow: false });
    }

    // This status transition is a second conditional CAS. Only one duplicate
    // post-frozen dispatch can acquire it and proceed to verify/POST.
    if (!(await this.dependencies.repository.claimPostAttempt({
      environment: attemptPublication.environment,
      date: attemptPublication.date,
      runId: attemptPublication.runId,
      retryChainId: request.retryChainId,
      attempt: request.attempt,
    })).claimed) {
      return this.withIdentity(outcome('skipped_duplicate', false), { publication: attemptPublication, request, collectedNow: false });
    }
    attemptPublication = await this.dependencies.repository.getPublication(request.environment, request.date);
    publication = attemptPublication;

    // Revalidate the durable row after acquiring the HTTP-phase CAS; otherwise
    // a malformed/corrupted read could cross the network boundary.
    if (!hasValidFrozenPayload(publication)) {
      await this.dependencies.repository.markFailed(publication.runId, 'BATCH_INTEGRITY_ERROR');
      return this.withIdentity(outcome('failed', false, 'BATCH_INTEGRITY_ERROR'), { publication, request, collectedNow: false });
    }

    // Every post-frozen phase is a separate process from freeze/Actions upload.
    // Only NOT_FOUND proves that another POST is safe.
    const postVerification = await this.verifyRemotely(publication);
    if (postVerification.kind === 'match') return this.reconcileMatch(publication, request, postVerification.status);
    if (postVerification.kind === 'conflict') {
      await this.dependencies.repository.markFailed(publication.runId, 'REMOTE_VALUE_CONFLICT');
      await this.persistArtifactsBestEffort(publication, request, false, 'failed', 'REMOTE_VALUE_CONFLICT', postVerification.status, false);
      return this.withIdentity(outcome('failed', false, 'REMOTE_VALUE_CONFLICT'), { publication, request, collectedNow: false });
    }
    if (postVerification.kind === 'unavailable') {
      const retryable = postVerification.retryable ?? true;
      await this.persistArtifactsBestEffort(publication, request, false, 'verify_pending', null, postVerification.status, retryable, postVerification.retryAfterMs);
      return this.withIdentity({
        ...outcome('verify_pending', false), retryable, retryAfterMs: postVerification.retryAfterMs ?? null,
      }, { publication, request, collectedNow: false });
    }

    let response: RemotePost;
    try {
      response = await this.dependencies.remoteClient.post(publication.frozenPayload!);
    } catch (error) {
      const classification = classifyPublicationError(error);
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : null;
      await this.dependencies.repository.markFailed(publication.runId, 'REMOTE_POST_ERROR').catch(() => undefined);
      await this.persistArtifactsBestEffort(publication, request, false, 'failed', 'REMOTE_POST_ERROR', status, classification.retryable);
      return this.withIdentity({ ...outcome('failed', false, 'REMOTE_POST_ERROR'), retryable: classification.retryable }, { publication, request, collectedNow: false });
    }
    if (response.kind !== 'accepted' || response.status < 200 || response.status >= 300) {
      const failureCode = 'REMOTE_POST_ERROR';
      await this.dependencies.repository.markFailed(publication.runId, failureCode).catch(() => undefined);
      const classification = classifyPublicationError(response);
      const retryAfterMs = response.kind !== 'accepted' ? response.retryAfterMs ?? null : null;
      await this.persistArtifactsBestEffort(publication, request, false, 'failed', failureCode, response.status, classification.retryable, retryAfterMs);
      return this.withIdentity({
        ...outcome('failed', false, failureCode), retryable: classification.retryable, retryAfterMs,
      }, { publication, request, collectedNow: false });
    }

    // A remote 2xx is definitive acceptance evidence immediately. Everything
    // after this point is best-effort reconciliation and cannot enable repost.
    const accepted = outcome('verify_pending', true);
    try {
      await this.dependencies.repository.markAccepted(publication.runId, this.dependencies.clock.now().toISOString());
    } catch {
      await this.persistArtifactsBestEffort(publication, request, true, 'verify_pending', null, response.status, false);
      return this.withIdentity(accepted, { publication, request, collectedNow: false });
    }

    const verification = await this.verifyRemotely(publication);
    if (verification.kind === 'match') return this.reconcileMatch(publication, request, verification.status);
    if (verification.kind === 'conflict') {
      await this.persistArtifactsBestEffort(publication, request, true, 'failed', 'REMOTE_VALUE_CONFLICT', verification.status, false);
      return this.withIdentity(outcome('failed', true, 'REMOTE_VALUE_CONFLICT'), { publication, request, collectedNow: false });
    }
    await this.persistArtifactsBestEffort(publication, request, true, 'verify_pending', null, verification.status, false);
    return this.withIdentity(accepted, { publication, request, collectedNow: false });
  }

  private async reconcileAccepted(publication: PublicationRecord, request: PublishRequest): Promise<PublishOutcome> {
    if (!hasValidFrozenPayload(publication)) return this.withIdentity(outcome('verify_pending', true), { publication, request, collectedNow: false });
    const verification = await this.verifyRemotely(publication);
    if (verification.kind === 'match') return this.reconcileMatch(publication, request, verification.status);
    if (verification.kind === 'conflict') {
      await this.persistArtifactsBestEffort(publication, request, true, 'failed', 'REMOTE_VALUE_CONFLICT', verification.status, false);
      return this.withIdentity(outcome('failed', true, 'REMOTE_VALUE_CONFLICT'), { publication, request, collectedNow: false });
    }
    await this.persistArtifactsBestEffort(publication, request, true, 'verify_pending', null, verification.status, false);
    return this.withIdentity(outcome('verify_pending', true), { publication, request, collectedNow: false });
  }

  private async reconcileMatch(publication: PublicationRecord, request: PublishRequest, status: number): Promise<PublishOutcome> {
    try {
      if (!publication.acceptedAt) await this.dependencies.repository.markAccepted(publication.runId, this.dependencies.clock.now().toISOString());
      await this.dependencies.repository.markDelivered(publication.runId, this.dependencies.clock.now().toISOString());
    } catch {
      await this.persistArtifactsBestEffort(publication, request, true, 'verify_pending', null, status, false);
      return this.withIdentity(outcome('verify_pending', true), { publication, request, collectedNow: false });
    }
    await this.persistArtifactsBestEffort(publication, request, true, 'delivered', null, status, false);
    return this.withIdentity(outcome('delivered', true), { publication, request, collectedNow: false });
  }

  private async verifyRemotely(publication: PublicationRecord & { frozenBatch: NonNullable<PublicationRecord['frozenBatch']> }): Promise<RemoteVerification> {
    try {
      return await this.dependencies.remoteClient.verify(publication.environment, publication.date, publication.frozenBatch.measurements);
    } catch (error) {
      const classification = classifyPublicationError(error);
      return {
        kind: 'unavailable', status: isRecord(error) && typeof error.status === 'number' ? error.status : null,
        retryable: classification.retryable, retryAfterMs: getRetryAfterMs(error),
        ...(isRecord(error) && (error.kind === 'network' || error.kind === 'timeout') ? { errorKind: error.kind } : {}),
      };
    }
  }

  private async persistArtifacts(
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
    const artifacts = buildPublicationArtifacts({
      frozenPayload: publication.frozenPayload, runId: publication.runId, date: publication.date,
      environment: publication.environment, payloadSha256: publication.payloadSha256,
      diagnostics: publication.frozenBatch.diagnostics, postAccepted, status, failureCode,
      retry: { retryChainId: request.retryChainId, attempt: request.attempt }, httpStatus, retryable, retryAfterMs,
    });
    try {
      await this.dependencies.artifactWriter.write(artifacts);
    } catch {
      throw new KpiArtifactPersistenceError();
    }
  }

  private async persistArtifactsBestEffort(
    publication: PublicationRecord,
    request: PublishRequest,
    postAccepted: boolean,
    status: string,
    failureCode: string | null,
    httpStatus: number | null,
    retryable: boolean,
    retryAfterMs: number | null = null,
  ): Promise<void> {
    try {
      await this.persistArtifacts(publication, request, postAccepted, status, failureCode, httpStatus, retryable, retryAfterMs);
    } catch {
      // After HTTP 2xx, local artifact failure cannot make an accepted POST safe to repeat.
    }
  }

  private withIdentity(outcomeValue: PublishOutcome, prepared: {
    publication: PublicationRecord;
    request: PublishRequest;
    collectedNow?: boolean;
  }): PublishOutcome {
    return {
      ...outcomeValue,
      runId: prepared.publication.runId,
      retryChainId: prepared.publication.retryChainId,
    };
  }
}

function hasValidFrozenPayload(
  publication: PublicationRecord,
): publication is PublicationRecord & { frozenPayload: Buffer; payloadSha256: string; frozenBatch: NonNullable<PublicationRecord['frozenBatch']> } {
  if (!publication.frozenPayload || !publication.payloadSha256 || !publication.frozenBatch) return false;
  const measurements = publication.frozenBatch.measurements;
  if (measurements.length !== KPI_IDS.length) return false;
  const ids = measurements.map(measurement => measurement.kpi_id);
  if (new Set(ids).size !== KPI_IDS.length || KPI_IDS.some(id => !ids.includes(id))) return false;
  if (publication.frozenBatch.context.run_id !== publication.runId ||
    publication.frozenBatch.context.date !== publication.date ||
    publication.frozenBatch.context.environment !== publication.environment ||
    measurements.some(measurement => measurement.run_id !== publication.runId ||
      measurement.date !== publication.date || measurement.env !== publication.environment)) return false;
  const canonical = canonicalPayloadBytes(measurements);
  if (!canonical.equals(publication.frozenPayload)) return false;
  const digest = createHash('sha256').update(publication.frozenPayload).digest('hex');
  return digest === publication.payloadSha256 && digest === publication.frozenBatch.payload_sha256;
}

function hasFrozenPayloadMaterial(publication: PublicationRecord): boolean {
  return publication.frozenBatch !== null || publication.frozenPayload !== null || publication.payloadSha256 !== null;
}

function isAllowedAttempt(value: number): value is 0 | 1 | 2 {
  return value === 0 || value === 1 || value === 2;
}

function getRetryAfterMs(error: unknown): number | null {
  return isRecord(error) && typeof error.retryAfterMs === 'number' ? error.retryAfterMs : null;
}

function outcome(status: string, postAccepted: boolean, failureCode?: string): PublishOutcome {
  return { status, postAccepted, ...(failureCode ? { failureCode } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
