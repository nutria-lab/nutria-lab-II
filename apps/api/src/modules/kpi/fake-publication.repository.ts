import type { FrozenBatch, KpiEnvironment } from './kpi-contract';
import type { PublicationRecord, PublicationRepository, PublicationReservation } from './publication-repository.port';

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
      // Reserving the unique publication row is the claim for initial attempt
      // zero.  Retry claims advance this same row through the CAS below.
      attemptCount: 0,
    };
    this.publications.set(key, publication);
    return publication;
  }

  async getPublication(environment: KpiEnvironment, date: string): Promise<PublicationRecord> {
    const publication = this.publications.get(publicationKey(environment, date));
    if (!publication) throw new Error(`Unknown KPI publication: ${environment}/${date}`);
    return publication;
  }

  async freezeBatchConditionally(runId: string, batch: FrozenBatch, payload: Buffer): Promise<{ won: boolean; publication: PublicationRecord }> {
    const publication = this.byRunId(runId);
    if (publication.frozenBatch) return { won: false, publication };

    publication.frozenBatch = batch;
    publication.frozenPayload = Buffer.from(payload);
    publication.payloadSha256 = batch.payload_sha256;
    publication.status = 'frozen';
    return { won: true, publication };
  }

  async claimAttempt(retryChainId: string, attempt: number): Promise<{ claimed: boolean }> {
    // This deliberately mirrors a single conditional UPDATE over the unique
    // environment/date row. With no await before the mutation, concurrent
    // callers observe the winner's increment and return duplicate.
    const publication = [...this.publications.values()].find((candidate) => candidate.retryChainId === retryChainId);
    if ((attempt !== 1 && attempt !== 2) || !publication ||
      publication.attemptCount !== attempt - 1 ||
      !isRetryEligible(publication)) {
      return { claimed: false };
    }

    publication.attemptCount += 1;
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
  return publication.status !== 'accepted' &&
    publication.status !== 'delivered' &&
    publication.acceptedAt === null &&
    publication.deliveredAt === null;
}

function publicationKey(environment: KpiEnvironment, date: string): string {
  return `${environment}:${date}`;
}
