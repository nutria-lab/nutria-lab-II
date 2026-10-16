import { BadRequestException, Controller, Inject, InternalServerErrorException, Logger, Post, Body, UseGuards } from '@nestjs/common';
import type { KpiEnvironment } from './kpi-contract';
import type { KpiConfig } from './config/kpi-config';
import { KPI_CONFIG, KPI_REPORTING_STORE } from './kpi.tokens';
import { KpiInternalAuthGuard } from './kpi-internal-auth.guard';
import type { TelemetryCliStore } from './db/kpi-reporting-store';
import { computePurgeCutoff, runPurge } from './cli/purge-policy';
import { scheduledBucket } from './window/kpi-window';
import type { KpiSampleRequest } from './kpi-api-client';
import { INSTRUMENTATION_DISABLED } from './calc/telemetry-formulas';

const logger = new Logger('KpiTelemetryController');
const TECHNICAL_REASON = /^[A-Z][A-Z0-9_]{0,63}$/;

@Controller('kpi/telemetry')
@UseGuards(KpiInternalAuthGuard)
export class KpiTelemetryController {
  constructor(
    @Inject(KPI_CONFIG) private readonly config: KpiConfig,
    @Inject(KPI_REPORTING_STORE) private readonly store: TelemetryCliStore,
  ) {}

  @Post('sample')
  async sample(@Body() body: unknown) {
    const environment = this.requireEnvironment();
    const request = parseSampleRequest(body);
    const now = new Date();
    const scheduledFor = new Date(request.scheduled_for);
    const measuredAt = new Date(request.measured_at);
    if (
      !validDate(scheduledFor) || !validDate(measuredAt) ||
      scheduledBucket(measuredAt).getTime() !== scheduledFor.getTime() ||
      Math.abs(Date.now() - measuredAt.getTime()) > 120_000
    ) {
      throw new BadRequestException('KPI_SAMPLE_BUCKET_INVALID');
    }
    const outcome = request.api_ok === false || request.database_ok === false
      ? 'unhealthy'
      : request.api_ok === null || request.database_ok === null
        ? 'unknown'
        : 'healthy';
    const reason = this.config.enabled ? request.reason : INSTRUMENTATION_DISABLED;

    try {
      const inserted = await this.store.insertHealthSample({
        environment,
        scheduledFor,
        measuredAt,
        apiOk: request.api_ok,
        databaseOk: request.database_ok,
        outcome,
        reason,
      });

      const cutoff = computePurgeCutoff(now);
      const purge = cutoff === null
        ? { executed: false, cutoff: null as string | null, deleted: null as Record<string, number> | null }
        : { executed: true, cutoff: cutoff.date, deleted: (await runPurge(this.store, environment, cutoff)).deleted };

      return {
        sample: { outcome, inserted, reason },
        purge,
      };
    } catch {
      logger.error('KPI_TELEMETRY_SAMPLE_FAILED');
      throw new InternalServerErrorException('KPI_TELEMETRY_SAMPLE_FAILED');
    }
  }

  private requireEnvironment(): KpiEnvironment {
    if (this.config.environment === null) throw new InternalServerErrorException('KPI_ENV_MISSING');
    return this.config.environment;
  }
}

function parseSampleRequest(value: unknown): KpiSampleRequest {
  if (typeof value !== 'object' || value === null) throw new BadRequestException('KPI_SAMPLE_INVALID');
  const body = value as Record<string, unknown>;
  const nullableBoolean = (field: unknown): field is boolean | null => field === null || typeof field === 'boolean';
  if (
    typeof body.scheduled_for !== 'string' ||
    typeof body.measured_at !== 'string' ||
    !nullableBoolean(body.api_ok) ||
    !nullableBoolean(body.database_ok) ||
    !(body.reason === null || (typeof body.reason === 'string' && TECHNICAL_REASON.test(body.reason)))
  ) throw new BadRequestException('KPI_SAMPLE_INVALID');
  return body as unknown as KpiSampleRequest;
}

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}
