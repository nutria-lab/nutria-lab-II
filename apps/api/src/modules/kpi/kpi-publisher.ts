import { createHash } from 'node:crypto';

import { freezeBatch } from './kpi-batch';
import type { CollectionContext, KpiEnvironment, KpiLogger } from './kpi-contract';
import { buildPublicationArtifacts } from './kpi-artifacts';
import { resolveArgentinaKpiWindow, type Clock } from './kpi-window';
import type { PublicationRecord, PublicationRepository } from './publication-repository.port';

export class StructuralKpiError extends Error {}

export function classifyPublicationError(error: unknown): { retryable: boolean } {
  if (error instanceof StructuralKpiError) return { retryable: false };
  if (isRecord(error) && (error.code === 'REMOTE_VALUE_CONFLICT' || error.code === 'CATALOG_CONFLICT')) return { retryable: false };
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

type RemotePost = { kind: 'accepted'; status: number } | { kind: string; status: number };
type RemoteVerification = { kind: 'match' | 'unavailable' | 'conflict'; status: number };

export interface KpiPublisherDependencies {
  repository: PublicationRepository;
  logger: KpiLogger;
  remoteClient: { post(payload: Buffer): Promise<RemotePost>; verify(environment: KpiEnvironment, date: string): Promise<RemoteVerification> };
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
}

/** Coordinates ports only: no database, network, or credential implementation lives here. */
export class KpiPublisher {
  private readonly acceptedRuns = new Set<string>();

  constructor(private readonly dependencies: KpiPublisherDependencies) {}

  async publish(request: PublishRequest): Promise<{ status: string; postAccepted: boolean; failureCode?: string }> {
    let publication = await this.dependencies.repository.reservePublication({
      environment: request.environment,
      date: request.date,
      runId: this.dependencies.idGenerator.next(),
      sourceCommit: request.sourceCommit,
      retryChainId: request.retryChainId,
    });

    if (publication.status === 'accepted' || publication.status === 'delivered' || publication.acceptedAt || this.acceptedRuns.has(publication.runId)) {
      return { status: publication.status === 'delivered' ? 'delivered' : 'verify_pending', postAccepted: true };
    }

    // The reservation itself owns initial attempt zero. Retries use the same
    // durable publication row as an atomic compare-and-set claim.
    if (request.attempt === 1 || request.attempt === 2) {
      if (!(await this.dependencies.repository.claimAttempt(request.retryChainId, request.attempt)).claimed) {
        return { status: 'skipped_duplicate', postAccepted: false };
      }
    }

    if (!publication.frozenBatch) {
      const window = resolveArgentinaKpiWindow(request.date, this.dependencies.clock);
      const context: CollectionContext = { contract_version: '1', ...window, environment: request.environment, run_id: publication.runId };
      const batch = freezeBatch(context, await this.dependencies.logger.collect(context));
      publication = (await this.dependencies.repository.freezeBatchConditionally(publication.runId, batch, Buffer.from(JSON.stringify(batch.measurements), 'utf8'))).publication;
    }

    if (!hasValidFrozenPayload(publication)) {
      await this.dependencies.repository.markFailed(publication.runId, 'BATCH_INTEGRITY_ERROR');
      return { status: 'failed', postAccepted: false, failureCode: 'BATCH_INTEGRITY_ERROR' };
    }

    const response = await this.dependencies.remoteClient.post(publication.frozenPayload);
    if (response.kind !== 'accepted' || response.status < 200 || response.status >= 300) {
      const failureCode = 'REMOTE_POST_ERROR';
      await this.dependencies.repository.markFailed(publication.runId, failureCode);
      return { status: 'failed', postAccepted: false, failureCode };
    }

    this.acceptedRuns.add(publication.runId);
    const acceptedAt = this.dependencies.clock.now().toISOString();
    try {
      await this.dependencies.repository.markAccepted(publication.runId, acceptedAt);
    } catch {
      await this.writeArtifacts(publication, request, true, 'verify_pending', null, response.status);
      return { status: 'verify_pending', postAccepted: true };
    }

    const verification = await this.dependencies.remoteClient.verify(request.environment, request.date);
    if (verification.kind === 'match') {
      await this.dependencies.repository.markDelivered(publication.runId, this.dependencies.clock.now().toISOString());
      await this.writeArtifacts(publication, request, true, 'delivered', null, verification.status);
      return { status: 'delivered', postAccepted: true };
    }
    const status = verification.kind === 'conflict' ? 'failed' : 'verify_pending';
    await this.writeArtifacts(publication, request, true, status, verification.kind === 'conflict' ? 'REMOTE_VALUE_CONFLICT' : null, verification.status);
    return { status, postAccepted: true };
  }

  private async writeArtifacts(publication: PublicationRecord, request: PublishRequest, postAccepted: boolean, status: string, failureCode: string | null, httpStatus: number | null): Promise<void> {
    if (!publication.frozenPayload || !publication.frozenBatch || !publication.payloadSha256) return;
    await this.dependencies.artifactWriter.write(buildPublicationArtifacts({
      frozenPayload: publication.frozenPayload, runId: publication.runId, date: publication.date,
      environment: publication.environment, payloadSha256: publication.payloadSha256,
      diagnostics: publication.frozenBatch.diagnostics, postAccepted, status, failureCode,
      retry: { retryChainId: request.retryChainId, attempt: request.attempt }, httpStatus,
    }));
  }
}

function hasValidFrozenPayload(publication: PublicationRecord): publication is PublicationRecord & { frozenPayload: Buffer; payloadSha256: string; frozenBatch: NonNullable<PublicationRecord['frozenBatch']> } {
  if (!publication.frozenPayload || !publication.payloadSha256 || !publication.frozenBatch) return false;
  return createHash('sha256').update(publication.frozenPayload).digest('hex') === publication.payloadSha256;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
