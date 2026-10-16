import type { FrozenBatch, KpiEnvironment } from './kpi-contract';
import { KpiPublicationNotFoundError } from './publication-repository.port';
import type { AttemptClaim, PublicationRecord, PublicationRepository, PublicationReservation } from './publication-repository.port';

/** Deterministic in-memory implementation used solely by unit tests. */
export class FakePublicationRepository implements PublicationRepository {
  private readonly publications = new Map<string, PublicationRecord>();

  async reservePublication(reservation: PublicationReservation): Promise<PublicationRecord> {
    const key = publicationKey(reservation.environment, reservation.date);
    const existing = this.publications.get(key);
    if (existing) return existing;

    const publication: PublicationRecord = {
      ...reservation,
      status: 'preparing',
      frozenBatch: null,
      frozenPayload: null,
      payloadSha256: null,
      acceptedAt: null,
      deliveredAt: null,
      failureCode: null,
      // The initial execution claims 0 -> 1 before network I/O. Subsequent
      // retries claim 1 -> 2 and 2 -> 3 on this same durable row.
      attemptCount: reservation.priorAttemptCount ?? 0,
    };
    this.publications.set(key, publication);
    return publication;
  }

  async getPublication(environment: KpiEnvironment, date: string): Promise<PublicationRecord> {
    const publication = this.publications.get(publicationKey(environment, date));
    if (!publication) throw new KpiPublicationNotFoundError(environment, date);
    return publication;
  }

  async freezeBatchConditionally(
    runId: string,
    batch: FrozenBatch,
    payload: Buffer,
    options: { keepPreparing?: boolean } = {},
  ): Promise<{ won: boolean; publication: PublicationRecord }> {
    const publication = this.byRunId(runId);
    if (publication.frozenBatch) return { won: false, publication };

    publication.frozenBatch = batch;
    publication.frozenPayload = Buffer.from(payload);
    publication.payloadSha256 = batch.payload_sha256;
    publication.status = options.keepPreparing ? 'preparing' : 'frozen';
    return { won: true, publication };
  }

  async claimAttempt(claim: AttemptClaim): Promise<{ claimed: boolean }> {
    // This deliberately mirrors a single conditional UPDATE over the unique
    // environment/date row. With no await before the mutation, concurrent
    // callers observe the winner's increment and return duplicate.
    const publication = this.publications.get(publicationKey(claim.environment, claim.date));
    if (!publication || publication.runId !== claim.runId || publication.retryChainId !== claim.retryChainId ||
      publication.attemptCount !== claim.attempt ||
      !isRetryEligible(publication)) {
      return { claimed: false };
    }

    publication.attemptCount += 1;
    publication.status = 'preparing';
    return { claimed: true };
  }

  async claimPostAttempt(claim: AttemptClaim): Promise<{ claimed: boolean }> {
    const publication = this.publications.get(publicationKey(claim.environment, claim.date));
    if (!publication || publication.runId !== claim.runId || publication.retryChainId !== claim.retryChainId ||
      publication.attemptCount !== claim.attempt + 1 || publication.status !== 'preparing' ||
      publication.acceptedAt !== null || publication.deliveredAt !== null) {
      return { claimed: false };
    }
    publication.status = 'frozen';
    return { claimed: true };
  }

  async markAccepted(runId: string, acceptedAt: string): Promise<void> {
    const publication = this.byRunId(runId);
    publication.status = 'accepted';
    publication.acceptedAt = acceptedAt;
  }

  async markDelivered(runId: string, deliveredAt: string): Promise<void> {
    const publication = this.byRunId(runId);
    publication.status = 'delivered';
    publication.deliveredAt = deliveredAt;
  }

  async markFailed(runId: string, failureCode: string): Promise<void> {
    const publication = this.byRunId(runId);
    if (publication.acceptedAt) return;
    publication.status = 'failed';
    publication.failureCode = failureCode;
  }

  async recoverManually(runId: string, retryChainId: string): Promise<PublicationRecord> {
    const publication = this.byRunId(runId);
    if (publication.status !== 'failed' || publication.attemptCount !== 3 || publication.acceptedAt || publication.deliveredAt ||
      !publication.frozenBatch || !publication.frozenPayload || !publication.payloadSha256 || publication.retryChainId === retryChainId) {
      throw new Error('KPI_MANUAL_RECOVERY_NOT_ELIGIBLE');
    }
    publication.retryChainId = retryChainId;
    publication.attemptCount = 0;
    publication.status = 'frozen';
    publication.failureCode = null;
    return publication;
  }

  async corruptPayloadShaForTest(runId: string, payloadSha256: string): Promise<void> {
    this.byRunId(runId).payloadSha256 = payloadSha256;
  }

  private byRunId(runId: string): PublicationRecord {
    for (const publication of this.publications.values()) {
      if (publication.runId === runId) return publication;
    }
    throw new Error(`Unknown KPI publication run: ${runId}`);
  }
}

function isRetryEligible(publication: PublicationRecord): boolean {
  const eligibleStatus = ['preparing', 'frozen', 'failed'].includes(publication.status);
  return eligibleStatus &&
    publication.acceptedAt === null &&
    publication.deliveredAt === null;
}

function publicationKey(environment: KpiEnvironment, date: string): string {
  return `${environment}:${date}`;
}
