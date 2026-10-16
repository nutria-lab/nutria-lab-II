import { BadRequestException, Controller, Inject, InternalServerErrorException, Logger, Post, Body, UseGuards } from '@nestjs/common';
import type { KpiEnvironment } from './kpi-contract';
import type { KpiConfig } from './config/kpi-config';
import { KPI_CONFIG, KPI_REPORTING_STORE } from './kpi.tokens';
import { KpiInternalAuthGuard } from './kpi-internal-auth.guard';
import type { TelemetryCliStore } from './db/kpi-reporting-store';
import { TelemetrySnapshotService } from './snapshots/telemetry-snapshot.service';
import { computePurgeCutoff, runPurge } from './cli/purge-policy';
import { resolvePreviewWindow, resolveFinalizeDate, scheduledBucket, KpiWindowError } from './window/kpi-window';
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
    let window;
    try {
      window = resolvePreviewWindow(now, request.preview_date);
    } catch (error) {
      if (error instanceof KpiWindowError) throw new BadRequestException(error.code);
      throw error;
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

      let preview: {
        executed: boolean;
        skip_reason: string | null;
        reused: boolean;
        results: readonly unknown[];
      };
      let counts: Record<string, number> | null = null;
      if (window.skipReason !== null) {
        preview = { executed: false, skip_reason: window.skipReason, reused: false, results: [] };
      } else {
        const run = await new TelemetrySnapshotService(this.store, () => new Date()).preview({
          environment,
          date: window.date,
          start: window.start,
          end: window.end,
        });
        preview = { executed: true, skip_reason: null, reused: run.reused, results: run.results };
        if (run.aggregates) {
          const { http, dependency, health } = run.aggregates;
          counts = {
            http_terminal: http.success + http.clientError + http.serverError + http.networkError + http.timeout + http.other,
            http_pending_incomplete: http.pendingIncomplete,
            dependency_attempts: dependency.success + dependency.error + dependency.timeout,
            health_samples: health.healthy + health.unhealthy + health.unknown,
          };
        }
      }

      const cutoff = computePurgeCutoff(now);
      const purge = cutoff === null || window.skipReason !== null
        ? { executed: false, cutoff: null as string | null, deleted: null as Record<string, number> | null }
        : { executed: true, cutoff: cutoff.date, deleted: (await runPurge(this.store, environment, cutoff)).deleted };

      return {
        sample: { outcome, inserted, reason },
        preview,
        counts,
        purge,
      };
    } catch {
      logger.error('KPI_TELEMETRY_SAMPLE_FAILED');
      throw new InternalServerErrorException('KPI_TELEMETRY_SAMPLE_FAILED');
    }
  }

  @Post('finalize')
  async finalize(@Body() body: unknown) {
    const environment = this.requireEnvironment();
    const date = parseFinalizeDate(body, environment);
    let cut;
    try {
      cut = resolveFinalizeDate(new Date(), date);
    } catch (error) {
      if (error instanceof KpiWindowError) throw new BadRequestException(error.code);
      throw error;
    }
    try {
      const run = await new TelemetrySnapshotService(this.store, () => new Date()).finalizeCore({ ...cut, environment });
      return { cut, results: run.results, reused: run.reused, aggregates: run.aggregates };
    } catch {
      logger.error('KPI_TELEMETRY_FINALIZE_FAILED');
      throw new InternalServerErrorException('KPI_TELEMETRY_FINALIZE_FAILED');
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
    !(body.reason === null || (typeof body.reason === 'string' && TECHNICAL_REASON.test(body.reason))) ||
    !(body.preview_date === undefined || typeof body.preview_date === 'string')
  ) throw new BadRequestException('KPI_SAMPLE_INVALID');
  return body as unknown as KpiSampleRequest;
}

function parseFinalizeDate(value: unknown, environment: KpiEnvironment): string {
  if (typeof value !== 'object' || value === null) throw new BadRequestException('KPI_FINALIZE_INVALID');
  const body = value as Record<string, unknown>;
  if (body.environment !== environment || typeof body.date !== 'string') {
    throw new BadRequestException('KPI_ENV_MISMATCH');
  }
  return body.date;
}

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}
