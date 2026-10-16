import { createHash } from 'node:crypto';
import { BadRequestException, Body, Controller, Inject, InternalServerErrorException, Logger, Post, UseGuards } from '@nestjs/common';

import { canonicalPayloadBytes } from './kpi-batch';
import type { FrozenBatch, KpiEnvironment } from './kpi-contract';
import type { KpiConfig } from './config/kpi-config';
import { KPI_CONFIG } from './kpi.tokens';
import { KpiInternalAuthGuard } from './kpi-internal-auth.guard';
import { PrismaPublicationRepository } from './prisma-publication.repository';
import type { PublicationRecord, PublicationReservation } from './publication-repository.port';
import { parseReportDate, windowForDate } from './window/kpi-window';
import { KpiWindowError } from './window/kpi-window';

const logger = new Logger('KpiPublicationController');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const TECHNICAL_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const KPI_IDS = new Set([
  'operations_count', 'error_rate', 'latency_p95_ms', 'health_status',
  'last_success_age_seconds', 'timeout_rate', 'dependency_error_rate', 'availability_rate',
  'initial_plans_count', 'manual_recipes_count',
]);

@Controller('kpi/publications')
@UseGuards(KpiInternalAuthGuard)
export class KpiPublicationController {
  constructor(
    @Inject(PrismaPublicationRepository) private readonly repository: PrismaPublicationRepository,
    @Inject(KPI_CONFIG) private readonly config: KpiConfig,
  ) {}

  @Post('reserve')
  async reserve(@Body() body: unknown) {
    const reservation = parseReservation(body);
    this.assertEnvironment(reservation.environment);
    return serialize(await this.execute('KPI_PUBLICATION_RESERVE_FAILED', () => this.repository.reservePublication(reservation)));
  }

  @Post('get')
  async get(@Body() body: unknown) {
    const input = asRecord(body, 'KPI_PUBLICATION_REQUEST_INVALID');
    const environment = parseEnvironment(input.environment);
    const date = parseDate(input.date);
    this.assertEnvironment(environment);
    return serialize(await this.execute('KPI_PUBLICATION_READ_FAILED', () => this.repository.getPublication(environment, date)));
  }

  @Post('freeze')
  async freeze(@Body() body: unknown) {
    const input = asRecord(body, 'KPI_PUBLICATION_REQUEST_INVALID');
    const runId = parseUuid(input.run_id);
    const batch = parseFrozenBatch(input.batch);
    this.assertEnvironment(batch.context.environment);
    if (runId !== batch.context.run_id) throw new BadRequestException('KPI_PUBLICATION_CONTEXT_MISMATCH');
    const payload = canonicalPayloadBytes(batch.measurements);
    const actualHash = createHash('sha256').update(payload).digest('hex');
    if (actualHash !== batch.payload_sha256) throw new BadRequestException('KPI_PUBLICATION_HASH_INVALID');
    const result = await this.execute('KPI_PUBLICATION_FREEZE_FAILED', () =>
      this.repository.freezeBatchConditionally(runId, batch, payload));
    return { won: result.won, publication: serialize(result.publication) };
  }

  @Post('claim-attempt')
  async claimAttempt(@Body() body: unknown) {
    const input = asRecord(body, 'KPI_PUBLICATION_REQUEST_INVALID');
    const retryChainId = parseUuid(input.retry_chain_id);
    if (input.attempt !== 1 && input.attempt !== 2) throw new BadRequestException('KPI_PUBLICATION_ATTEMPT_INVALID');
    return this.execute('KPI_PUBLICATION_CLAIM_FAILED', () => this.repository.claimAttempt(retryChainId, input.attempt as number));
  }

  @Post('manual-recovery')
  async manualRecovery(@Body() body: unknown) {
    const input = asRecord(body, 'KPI_PUBLICATION_REQUEST_INVALID');
    const environment = parseEnvironment(input.environment);
    const date = parseDate(input.date);
    const runId = parseUuid(input.run_id);
    const retryChainId = parseUuid(input.retry_chain_id);
    if (typeof input.source_commit !== 'string' || !/^[0-9a-f]{40}$/i.test(input.source_commit)) {
      throw new BadRequestException('KPI_PUBLICATION_SOURCE_COMMIT_INVALID');
    }
    this.assertEnvironment(environment);
    const publication = await this.execute('KPI_PUBLICATION_RECOVERY_FAILED', () => this.repository.beginManualRecovery({
      environment, date, runId, sourceCommit: input.source_commit as string, retryChainId,
    }));
    return serialize(publication);
  }

  @Post('mark-accepted')
  async markAccepted(@Body() body: unknown) {
    const input = asRecord(body, 'KPI_PUBLICATION_REQUEST_INVALID');
    const runId = parseUuid(input.run_id);
    const acceptedAt = parseTimestamp(input.accepted_at);
    await this.execute('KPI_PUBLICATION_ACCEPT_FAILED', () => this.repository.markAccepted(runId, acceptedAt));
    return { ok: true as const };
  }

  @Post('mark-delivered')
  async markDelivered(@Body() body: unknown) {
    const input = asRecord(body, 'KPI_PUBLICATION_REQUEST_INVALID');
    const runId = parseUuid(input.run_id);
    const deliveredAt = parseTimestamp(input.delivered_at);
    await this.execute('KPI_PUBLICATION_DELIVERY_FAILED', () => this.repository.markDelivered(runId, deliveredAt));
    return { ok: true as const };
  }

  @Post('mark-failed')
  async markFailed(@Body() body: unknown) {
    const input = asRecord(body, 'KPI_PUBLICATION_REQUEST_INVALID');
    const runId = parseUuid(input.run_id);
    if (typeof input.failure_code !== 'string' || !TECHNICAL_CODE.test(input.failure_code)) {
      throw new BadRequestException('KPI_PUBLICATION_FAILURE_CODE_INVALID');
    }
    await this.execute('KPI_PUBLICATION_FAILURE_RECORD_FAILED', () => this.repository.markFailed(runId, input.failure_code as string));
    return { ok: true as const };
  }

  private assertEnvironment(environment: KpiEnvironment): void {
    if (this.config.environment === null) throw new InternalServerErrorException('KPI_ENV_MISSING');
    if (this.config.environment !== environment) throw new BadRequestException('KPI_ENV_MISMATCH');
  }

  private async execute<T>(code: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch {
      logger.error(code);
      throw new InternalServerErrorException(code);
    }
  }
}

function parseReservation(value: unknown): PublicationReservation {
  const input = asRecord(value, 'KPI_PUBLICATION_REQUEST_INVALID');
  const reservation = asRecord(input.reservation, 'KPI_PUBLICATION_RESERVATION_INVALID');
  const environment = parseEnvironment(reservation.environment);
  const date = parseDate(reservation.date);
  const runId = parseUuid(reservation.runId);
  const retryChainId = parseUuid(reservation.retryChainId);
  if (typeof reservation.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(reservation.sourceCommit)) {
    throw new BadRequestException('KPI_PUBLICATION_SOURCE_COMMIT_INVALID');
  }
  return { environment, date, runId, retryChainId, sourceCommit: reservation.sourceCommit };
}

function parseFrozenBatch(value: unknown): FrozenBatch {
  const batch = asRecord(value, 'KPI_PUBLICATION_BATCH_INVALID');
  if (batch.contract_version !== '1' || !isRecord(batch.context) || !Array.isArray(batch.measurements) ||
    !Array.isArray(batch.diagnostics) || typeof batch.payload_sha256 !== 'string' || !SHA256.test(batch.payload_sha256)) {
    throw new BadRequestException('KPI_PUBLICATION_BATCH_INVALID');
  }
  const context = batch.context;
  const environment = parseEnvironment(context.environment);
  const date = parseDate(context.date);
  const runId = parseUuid(context.run_id);
  const expectedWindow = windowForDate(date);
  if (context.contract_version !== '1' || context.window_start !== expectedWindow.start.toISOString() ||
    context.window_end !== expectedWindow.end.toISOString() || batch.measurements.length !== KPI_IDS.size ||
    batch.diagnostics.length !== KPI_IDS.size) {
    throw new BadRequestException('KPI_PUBLICATION_CONTEXT_INVALID');
  }

  const measurementIds = new Set<string>();
  for (const raw of batch.measurements) {
    if (!isRecord(raw) || typeof raw.kpi_id !== 'string' || !KPI_IDS.has(raw.kpi_id) || measurementIds.has(raw.kpi_id) ||
      raw.date !== date || raw.env !== environment || raw.run_id !== runId ||
      typeof raw.value !== 'number' || !Number.isFinite(raw.value)) {
      throw new BadRequestException('KPI_PUBLICATION_MEASUREMENTS_INVALID');
    }
    measurementIds.add(raw.kpi_id);
  }
  if (!sameSet(measurementIds, KPI_IDS)) throw new BadRequestException('KPI_PUBLICATION_MEASUREMENTS_INVALID');

  const diagnosticIds = new Set<string>();
  for (const raw of batch.diagnostics) {
    if (!isRecord(raw) || typeof raw.kpi_id !== 'string' || !KPI_IDS.has(raw.kpi_id) || diagnosticIds.has(raw.kpi_id) ||
      (raw.quality !== 'observed' && raw.quality !== 'defaulted') ||
      !(raw.reason === null || (typeof raw.reason === 'string' && TECHNICAL_CODE.test(raw.reason))) ||
      !Number.isInteger(raw.sample_count) || (raw.sample_count as number) < 0) {
      throw new BadRequestException('KPI_PUBLICATION_DIAGNOSTICS_INVALID');
    }
    diagnosticIds.add(raw.kpi_id);
  }
  if (!sameSet(diagnosticIds, KPI_IDS)) throw new BadRequestException('KPI_PUBLICATION_DIAGNOSTICS_INVALID');

  return batch as unknown as FrozenBatch;
}

function parseEnvironment(value: unknown): KpiEnvironment {
  if (value !== 'dev' && value !== 'qa' && value !== 'prod') throw new BadRequestException('KPI_ENV_INVALID');
  return value;
}

function parseDate(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('KPI_DATE_INVALID');
  try {
    return parseReportDate(value);
  } catch (error) {
    if (error instanceof KpiWindowError) throw new BadRequestException(error.code);
    throw error;
  }
}

function parseUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException('KPI_UUID_INVALID');
  return value;
}

function parseTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new BadRequestException('KPI_TIMESTAMP_INVALID');
  return value;
}

function asRecord(value: unknown, code: string): Record<string, unknown> {
  if (!isRecord(value)) throw new BadRequestException(code);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...right].every(value => left.has(value));
}

function serialize(record: PublicationRecord) {
  return {
    runId: record.runId,
    environment: record.environment,
    date: record.date,
    sourceCommit: record.sourceCommit,
    retryChainId: record.retryChainId,
    status: record.status,
    frozenBatch: record.frozenBatch,
    payloadSha256: record.payloadSha256,
    acceptedAt: record.acceptedAt,
    deliveredAt: record.deliveredAt,
    failureCode: record.failureCode,
    attemptCount: record.attemptCount,
  };
}
