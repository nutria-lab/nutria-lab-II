import { createHash } from 'node:crypto';

import { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

import { canonicalPayloadBytes } from './kpi-batch';
import type { FrozenBatch, Measurement } from './kpi-contract';
import type { PublicationRecord, PublicationRepository, PublicationReservation, PublicationStatus } from './publication-repository.port';
import { windowForDate } from './window/kpi-window';

/**
 * Persistence adapter for the KpiPublication row introduced by NUT-85.
 * JSONB is reconstructed through the canonical measurement projection before
 * its stored SHA is trusted for a POST.
 */
export class PrismaPublicationRepository implements PublicationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async reservePublication(reservation: PublicationReservation): Promise<PublicationRecord> {
    const window = windowForDate(reservation.date);
    const existing = await this.prisma.kpiPublication.findFirst({
      where: { environment: reservation.environment, reportDate: reportDate(reservation.date) },
    });
    if (existing) return toPublicationRecord(existing);

    try {
      const created = await this.prisma.kpiPublication.create({
        data: {
          runId: reservation.runId,
          environment: reservation.environment,
          reportDate: reportDate(reservation.date),
          windowStart: window.start,
          windowEnd: window.end,
          status: 'preparing',
          sourceCommit: reservation.sourceCommit,
          retryChainId: reservation.retryChainId,
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
    if (!publication) throw new Error(`Unknown KPI publication: ${environment}/${date}`);
    return toPublicationRecord(publication);
  }

  async freezeBatchConditionally(
    runId: string,
    batch: FrozenBatch,
    payload: Buffer,
  ): Promise<{ won: boolean; publication: PublicationRecord }> {
    if (sha256(payload) !== batch.payload_sha256) {
      throw new Error('Frozen KPI payload does not match its SHA-256');
    }

    const result = await this.prisma.kpiPublication.updateMany({
      where: { runId, frozenBatch: { equals: Prisma.DbNull } },
      data: {
        frozenBatch: batch as unknown as Prisma.InputJsonValue,
        payloadSha256: batch.payload_sha256,
        status: 'frozen',
        windowStart: new Date(batch.context.window_start),
        windowEnd: new Date(batch.context.window_end),
        updatedAt: new Date(),
      },
    });
    const publication = await this.findByRunId(runId);
    return { won: result.count === 1, publication: toPublicationRecord(publication) };
  }

  async claimAttempt(retryChainId: string, attempt: number): Promise<{ claimed: boolean }> {
    if (attempt !== 1 && attempt !== 2) return { claimed: false };
    const result = await this.prisma.kpiPublication.updateMany({
      where: {
        retryChainId,
        attemptCount: attempt - 1,
        status: { in: ['frozen', 'failed'] },
        acceptedAt: null,
        deliveredAt: null,
      },
      data: { attemptCount: { increment: 1 }, updatedAt: new Date() },
    });
    return { claimed: result.count === 1 };
  }

  async markAccepted(runId: string, acceptedAt: string): Promise<void> {
    await this.prisma.kpiPublication.updateMany({
      where: { runId, acceptedAt: null, deliveredAt: null },
      data: { status: 'accepted', acceptedAt: new Date(acceptedAt), updatedAt: new Date() },
    });
  }

  async markDelivered(runId: string, deliveredAt: string): Promise<void> {
    await this.prisma.kpiPublication.updateMany({
      where: { runId, acceptedAt: { not: null }, deliveredAt: null },
      data: { status: 'delivered', deliveredAt: new Date(deliveredAt), updatedAt: new Date() },
    });
  }

  async markFailed(runId: string, failureCode: string): Promise<void> {
    await this.prisma.kpiPublication.updateMany({
      where: { runId, acceptedAt: null, deliveredAt: null },
      data: { status: 'failed', lastError: failureCode, updatedAt: new Date() },
    });
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
