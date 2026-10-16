import { createHash } from 'node:crypto';

import { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

import { canonicalPayloadBytes } from './kpi-batch';
import type { FrozenBatch, Measurement } from './kpi-contract';
import { KpiPublicationNotFoundError } from './publication-repository.port';
import type { AttemptClaim, PublicationRecord, PublicationRepository, PublicationReservation, PublicationStatus } from './publication-repository.port';
import { calculateArgentinaKpiWindow } from './kpi-window';

/**
 * Persistence adapter for the KpiPublication row introduced by NUT-85.
 * JSONB is reconstructed through the canonical measurement projection before
 * its stored SHA is trusted for a POST.
 */
export class PrismaPublicationRepository implements PublicationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async reservePublication(reservation: PublicationReservation): Promise<PublicationRecord> {
    const existing = await this.prisma.kpiPublication.findFirst({
      where: { environment: reservation.environment, reportDate: reportDate(reservation.date) },
    });
    if (existing) return toPublicationRecord(existing);

    const window = calculateArgentinaKpiWindow(reservation.date);
    const suppliedStart = reservation.windowStart;
    const suppliedEnd = reservation.windowEnd;
    const suppliedStartMs = suppliedStart === undefined ? null : Date.parse(suppliedStart);
    const suppliedEndMs = suppliedEnd === undefined ? null : Date.parse(suppliedEnd);
    if ((suppliedStart === undefined) !== (suppliedEnd === undefined) ||
      (suppliedStartMs !== null && (!Number.isFinite(suppliedStartMs) || suppliedStartMs !== Date.parse(window.window_start))) ||
      (suppliedEndMs !== null && (!Number.isFinite(suppliedEndMs) || suppliedEndMs !== Date.parse(window.window_end)))) {
      throw new Error('KPI_WINDOW_INVALID');
    }
    try {
      const created = await this.prisma.kpiPublication.create({
        data: {
          runId: reservation.runId,
          environment: reservation.environment,
          reportDate: reportDate(reservation.date),
          windowStart: new Date(window.window_start),
          windowEnd: new Date(window.window_end),
          status: 'preparing',
          sourceCommit: reservation.sourceCommit,
          retryChainId: reservation.retryChainId,
          attemptCount: reservation.priorAttemptCount ?? 0,
          updatedAt: new Date(),
        },
      });
      return toPublicationRecord(created);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.getPublication(reservation.environment, reservation.date);
    }
  }

  async getPublication(environment: PublicationReservation['environment'], date: string): Promise<PublicationRecord> {
    const publication = await this.prisma.kpiPublication.findFirst({
      where: { environment, reportDate: reportDate(date) },
    });
    if (!publication) throw new KpiPublicationNotFoundError(environment, date);
    return toPublicationRecord(publication);
  }

  async freezeBatchConditionally(
    runId: string,
    batch: FrozenBatch,
    payload: Buffer,
    options: { keepPreparing?: boolean } = {},
  ): Promise<{ won: boolean; publication: PublicationRecord }> {
    if (sha256(payload) !== batch.payload_sha256) {
      throw new Error('Frozen KPI payload does not match its SHA-256');
    }

    const result = await this.prisma.kpiPublication.updateMany({
      where: { runId, frozenBatch: { equals: Prisma.DbNull } },
      data: {
        frozenBatch: batch as unknown as Prisma.InputJsonValue,
        payloadSha256: batch.payload_sha256,
        status: options.keepPreparing ? 'preparing' : 'frozen',
        windowStart: new Date(batch.context.window_start),
        windowEnd: new Date(batch.context.window_end),
        updatedAt: new Date(),
      },
    });
    const publication = await this.findByRunId(runId);
    return { won: result.count === 1, publication: toPublicationRecord(publication) };
  }

  async claimAttempt(claim: AttemptClaim): Promise<{ claimed: boolean }> {
    if (claim.attempt !== 0 && claim.attempt !== 1 && claim.attempt !== 2) return { claimed: false };
    const result = await this.prisma.kpiPublication.updateMany({
      where: {
        environment: claim.environment,
        reportDate: reportDate(claim.date),
        runId: claim.runId,
        retryChainId: claim.retryChainId,
        attemptCount: claim.attempt,
        status: { in: ['preparing', 'frozen', 'failed'] },
        acceptedAt: null,
        deliveredAt: null,
      },
      data: { attemptCount: { increment: 1 }, status: 'preparing', updatedAt: new Date() },
    });
    return { claimed: result.count === 1 };
  }

  async claimPostAttempt(claim: AttemptClaim): Promise<{ claimed: boolean }> {
    if (claim.attempt !== 0 && claim.attempt !== 1 && claim.attempt !== 2) return { claimed: false };
    const result = await this.prisma.kpiPublication.updateMany({
      where: {
        environment: claim.environment,
        reportDate: reportDate(claim.date),
        runId: claim.runId,
        retryChainId: claim.retryChainId,
        attemptCount: claim.attempt + 1,
        status: 'preparing',
        acceptedAt: null,
        deliveredAt: null,
      },
      data: { status: 'frozen', updatedAt: new Date() },
    });
    return { claimed: result.count === 1 };
  }

  async markAccepted(runId: string, acceptedAt: string): Promise<void> {
    const result = await this.prisma.kpiPublication.updateMany({
      where: { runId, acceptedAt: null, deliveredAt: null },
      data: { status: 'accepted', acceptedAt: new Date(acceptedAt), updatedAt: new Date() },
    });
    if (result.count === 1) return;
    const current = toPublicationRecord(await this.findByRunId(runId));
    if (!current.acceptedAt && current.status !== 'accepted' && current.status !== 'delivered') {
      throw new Error('KPI_PUBLICATION_ACCEPTANCE_PERSIST_FAILED');
    }
  }

  async markDelivered(runId: string, deliveredAt: string): Promise<void> {
    const result = await this.prisma.kpiPublication.updateMany({
      where: { runId, acceptedAt: { not: null }, deliveredAt: null },
      data: { status: 'delivered', deliveredAt: new Date(deliveredAt), updatedAt: new Date() },
    });
    if (result.count === 1) return;
    const current = toPublicationRecord(await this.findByRunId(runId));
    if (!current.deliveredAt && current.status !== 'delivered') {
      throw new Error('KPI_PUBLICATION_DELIVERY_PERSIST_FAILED');
    }
  }

  async markFailed(runId: string, failureCode: string): Promise<void> {
    await this.prisma.kpiPublication.updateMany({
      where: { runId, acceptedAt: null, deliveredAt: null },
      data: { status: 'failed', lastError: failureCode, updatedAt: new Date() },
    });
  }

  async recoverManually(runId: string, retryChainId: string): Promise<PublicationRecord> {
    const result = await this.prisma.kpiPublication.updateMany({
      where: {
        runId, retryChainId: { not: retryChainId }, status: 'failed', acceptedAt: null, deliveredAt: null, attemptCount: 3,
        frozenBatch: { not: Prisma.DbNull }, payloadSha256: { not: null },
      },
      data: { retryChainId, attemptCount: 0, status: 'frozen', lastError: null, updatedAt: new Date() },
    });
    if (result.count !== 1) throw new Error('KPI_MANUAL_RECOVERY_NOT_ELIGIBLE');
    return toPublicationRecord(await this.findByRunId(runId));
  }

  private async findByRunId(runId: string) {
    const publication = await this.prisma.kpiPublication.findUnique({ where: { runId } });
    if (!publication) throw new Error(`Unknown KPI publication run: ${runId}`);
    return publication;
  }
}

function reportDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function toPublicationRecord(row: {
  runId: string; environment: string; reportDate: Date; sourceCommit: string; retryChainId: string; status: string;
  frozenBatch: Prisma.JsonValue | null; payloadSha256: string | null; acceptedAt: Date | null; deliveredAt: Date | null;
  lastError: string | null; attemptCount: number;
}): PublicationRecord {
  const frozenBatch = toFrozenBatch(row.frozenBatch);
  const frozenPayload = frozenBatch ? canonicalPayloadBytes(frozenBatch.measurements) : null;
  return {
    runId: row.runId,
    environment: row.environment as PublicationReservation['environment'],
    date: row.reportDate.toISOString().slice(0, 10),
    sourceCommit: row.sourceCommit,
    retryChainId: row.retryChainId,
    status: row.status as PublicationStatus,
    frozenBatch,
    frozenPayload,
    payloadSha256: row.payloadSha256,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    failureCode: row.lastError,
    attemptCount: row.attemptCount,
  };
}

function toFrozenBatch(value: Prisma.JsonValue | null): FrozenBatch | null {
  if (!isRecord(value) || !isRecord(value.context) || !Array.isArray(value.measurements) || !Array.isArray(value.diagnostics) ||
    value.contract_version !== '1' || typeof value.payload_sha256 !== 'string') return null;

  const context = value.context;
  if (context.contract_version !== '1' || typeof context.date !== 'string' || typeof context.environment !== 'string' ||
    typeof context.window_start !== 'string' || typeof context.window_end !== 'string' || typeof context.run_id !== 'string') return null;

  const measurements: Measurement[] = [];
  for (const measurement of value.measurements) {
    if (!isRecord(measurement) || typeof measurement.kpi_id !== 'string' || typeof measurement.date !== 'string' ||
      typeof measurement.env !== 'string' || typeof measurement.value !== 'number' || typeof measurement.run_id !== 'string') return null;
    measurements.push({
      kpi_id: measurement.kpi_id as Measurement['kpi_id'], date: measurement.date,
      env: measurement.env as Measurement['env'], value: measurement.value, run_id: measurement.run_id,
    });
  }
  const diagnostics: FrozenBatch['diagnostics'][number][] = [];
  for (const diagnostic of value.diagnostics) {
    if (!isRecord(diagnostic) || typeof diagnostic.kpi_id !== 'string' ||
      (diagnostic.quality !== 'observed' && diagnostic.quality !== 'defaulted') ||
      (diagnostic.reason !== null && typeof diagnostic.reason !== 'string') || typeof diagnostic.sample_count !== 'number') return null;
    diagnostics.push({
      kpi_id: diagnostic.kpi_id as Measurement['kpi_id'], quality: diagnostic.quality,
      reason: diagnostic.reason, sample_count: diagnostic.sample_count,
    });
  }

  return {
    contract_version: '1',
    context: {
      contract_version: '1', date: context.date, environment: context.environment as Measurement['env'],
      window_start: context.window_start, window_end: context.window_end, run_id: context.run_id,
    },
    measurements,
    diagnostics,
    payload_sha256: value.payload_sha256,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
