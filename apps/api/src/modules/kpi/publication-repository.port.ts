import type { FrozenBatch, KpiEnvironment } from './kpi-contract';

export type PublicationStatus = 'preparing' | 'frozen' | 'accepted' | 'delivered' | 'failed';

export interface PublicationRecord {
  runId: string;
  environment: KpiEnvironment;
  date: string;
  sourceCommit: string;
  retryChainId: string;
  status: PublicationStatus;
  frozenBatch: FrozenBatch | null;
  frozenPayload: Buffer | null;
  payloadSha256: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  failureCode: string | null;
  /**
   * The initial reservation owns attempt zero.  Each successful retry CAS
   * advances this counter once, so it is the only durable claim state needed
   * for attempts one and two.
   */
  attemptCount: number;
}

export interface PublicationReservation {
  environment: KpiEnvironment;
  date: string;
  runId: string;
  sourceCommit: string;
  retryChainId: string;
}

/** Durable boundary required before a publication can reach the network. */
export interface PublicationRepository {
  reservePublication(reservation: PublicationReservation): Promise<PublicationRecord>;
  getPublication(environment: KpiEnvironment, date: string): Promise<PublicationRecord>;
  freezeBatchConditionally(runId: string, batch: FrozenBatch, payload: Buffer): Promise<{ won: boolean; publication: PublicationRecord }>;
  /**
   * Atomically claim a retry on the existing environment/date publication.
   * An adapter implements this as one conditional UPDATE: matching retry
   * chain, expected previous counter, eligible status and no acceptance or
   * delivery.  No separate claim table or schema field is required.
   */
  claimAttempt(retryChainId: string, attempt: number): Promise<{ claimed: boolean }>;
  beginManualRecovery(input: {
    environment: KpiEnvironment;
    date: string;
    runId: string;
    sourceCommit: string;
    retryChainId: string;
  }): Promise<PublicationRecord>;
  markAccepted(runId: string, acceptedAt: string): Promise<void>;
  markDelivered(runId: string, deliveredAt: string): Promise<void>;
  markFailed(runId: string, failureCode: string): Promise<void>;
}
