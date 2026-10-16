import type { CollectionContext, KpiId, KpiLogger, KpiResult } from './kpi-contract';

const telemetryKpiIds = [
  'operations_count',
  'error_rate',
  'latency_p95_ms',
  'health_status',
  'last_success_age_seconds',
  'timeout_rate',
  'dependency_error_rate',
  'availability_rate',
] as const satisfies readonly KpiId[];

const dataKpiIds = ['initial_plans_count', 'manual_recipes_count'] as const satisfies readonly KpiId[];

type Source = 'telemetry' | 'data';

/** Combines the independent technical and business KPI collection ports. */
export class CompositeKpiLogger implements KpiLogger {
  constructor(
    private readonly telemetryLogger: KpiLogger,
    private readonly dataLogger: KpiLogger,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async collect(context: CollectionContext): Promise<readonly KpiResult[]> {
    const collected = await Promise.allSettled([
      this.collectSource(this.telemetryLogger, context, telemetryKpiIds, 'telemetry'),
      this.collectSource(this.dataLogger, context, dataKpiIds, 'data'),
    ]);
    const failure = collected.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
    const [telemetry, data] = collected.map(result => (result as PromiseFulfilledResult<readonly KpiResult[]>).value);

    return [...telemetry, ...data].sort(compareKpiId);
  }

  private async collectSource(
    logger: KpiLogger,
    context: CollectionContext,
    expectedIds: readonly KpiId[],
    source: Source,
  ): Promise<readonly KpiResult[]> {
    try {
      const results = await logger.collect(context);
      return validateResults(results, expectedIds, source);
    } catch (error) {
      if (isExpectedSourceFailure(error)) {
        const measuredAt = this.clock().toISOString();
        return expectedIds.map((kpi_id) => unavailable(kpi_id, measuredAt));
      }

      throw error;
    }
  }
}

function validateResults(
  results: unknown,
  expectedIds: readonly KpiId[],
  source: Source,
): readonly KpiResult[] {
  if (!Array.isArray(results)) {
    throw new TypeError(`${source} KPI result must be an array`);
  }

  const expected = new Set<string>(expectedIds);
  const seen = new Set<string>();

  for (const result of results) {
    if (!isRecord(result)) {
      throw new TypeError(`${source} KPI result has an invalid shape`);
    }

    const kpiId = result.kpi_id;
    if (typeof kpiId !== 'string' || !expected.has(kpiId)) {
      throw new TypeError(`${source} KPI result has an unknown kpi_id`);
    }
    if (seen.has(kpiId)) {
      throw new TypeError(`${source} KPI result has a duplicate kpi_id`);
    }
    seen.add(kpiId);
    validateResultShape(result, source);
  }

  for (const id of expectedIds) {
    if (!seen.has(id)) {
      throw new TypeError(`${source} KPI result is missing ${id}`);
    }
  }

  return results as KpiResult[];
}

function validateResultShape(result: Record<string, unknown>, source: Source): void {
  if (result.quality !== 'observed' && result.quality !== 'unavailable') {
    throw new TypeError(`${source} KPI result has an invalid quality`);
  }

  if (result.quality === 'observed') {
    if (!Number.isFinite(result.value)) {
      throw new TypeError(`${source} observed KPI result must have a finite value`);
    }
    if (typeof result.reason !== 'object' || result.reason !== null) {
      throw new TypeError(`${source} observed KPI result has an invalid reason`);
    }
  } else if (result.value !== null || typeof result.reason !== 'string' || result.reason.length === 0) {
    throw new TypeError(`${source} unavailable KPI result has an incoherent value or reason`);
  }
  if (!Number.isInteger(result.sample_count) || (result.sample_count as number) < 0) {
    throw new TypeError(`${source} KPI result has an invalid sample_count`);
  }
  if (!isIsoTimestamp(result.measured_at)) {
    throw new TypeError(`${source} KPI result has an invalid measured_at timestamp`);
  }
}

function unavailable(kpi_id: KpiId, measured_at: string): KpiResult {
  return {
    kpi_id,
    value: null,
    quality: 'unavailable',
    reason: 'SOURCE_UNAVAILABLE',
    sample_count: 0,
    measured_at,
  };
}

function isExpectedSourceFailure(error: unknown): error is { code: 'SOURCE_UNAVAILABLE' } {
  return isRecord(error) && error.code === 'SOURCE_UNAVAILABLE';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function compareKpiId(left: KpiResult, right: KpiResult): number {
  return left.kpi_id < right.kpi_id ? -1 : left.kpi_id > right.kpi_id ? 1 : 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }

  return !Number.isNaN(Date.parse(value));
}
