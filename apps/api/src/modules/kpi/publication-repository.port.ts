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
   * Every network attempt, including the initial publication, advances this
   * counter through a single CAS: 0 -> 1, 1 -> 2, then 2 -> 3.
   */
  attemptCount: number;
}

export interface PublicationReservation {
  environment: KpiEnvironment;
  date: string;
  runId: string;
  sourceCommit: string;
  retryChainId: string;
  /** Resolved before persistence so the initial row satisfies the DB CHECK. */
  windowStart?: string;
  windowEnd?: string;
  /** Prior completed executions when retry has to recreate a pre-reservation row. */
  priorAttemptCount?: 0 | 1 | 2;
}

export interface AttemptClaim {
  environment: KpiEnvironment;
  date: string;
  runId: string;
  retryChainId: string;
  attempt: 0 | 1 | 2;
}

export class KpiPublicationNotFoundError extends Error {
  constructor(environment: KpiEnvironment, date: string) {
    super(`Unknown KPI publication: ${environment}/${date}`);
    this.name = 'KpiPublicationNotFoundError';
  }
}

/** Durable boundary required before a publication can reach the network. */
export interface PublicationRepository {
  reservePublication(reservation: PublicationReservation): Promise<PublicationRecord>;
  getPublication(environment: KpiEnvironment, date: string): Promise<PublicationRecord>;
  freezeBatchConditionally(
    runId: string,
    batch: FrozenBatch,
    payload: Buffer,
    options?: { keepPreparing?: boolean },
  ): Promise<{ won: boolean; publication: PublicationRecord }>;
  /**
   * Atomically claim an attempt on the existing environment/date publication.
   * An adapter implements this as one conditional UPDATE: matching retry
   * chain, expected previous counter, eligible status and no acceptance or
   * delivery.  No separate claim table or schema field is required.
   */
  claimAttempt(claim: AttemptClaim): Promise<{ claimed: boolean }>;
  /** Atomically acquires the one network phase for an already-claimed attempt. */
  claimPostAttempt(claim: AttemptClaim): Promise<{ claimed: boolean }>;
  markAccepted(runId: string, acceptedAt: string): Promise<void>;
  markDelivered(runId: string, deliveredAt: string): Promise<void>;
  markFailed(runId: string, failureCode: string): Promise<void>;
  /** Opens an explicitly authorized recovery chain after all three attempts. */
  recoverManually?(runId: string, retryChainId: string): Promise<PublicationRecord>;
}
