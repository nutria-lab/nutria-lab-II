import { CompositeKpiLogger } from './composite-kpi.logger';
import type { CollectionContext, KpiId, KpiResult } from './kpi-contract';
import { TelemetryLogger } from './telemetry-logger';
import { sampleAggregates } from './tests/telemetry-fakes.fixture';

const context: CollectionContext = {
  contract_version: '1',
  date: '2026-10-09',
  environment: 'qa',
  window_start: '2026-10-09T03:00:00.000Z',
  window_end: '2026-10-10T00:00:00.000Z',
  run_id: 'run-86',
};

const telemetryIds = [
  'operations_count',
  'error_rate',
  'latency_p95_ms',
  'health_status',
  'last_success_age_seconds',
  'timeout_rate',
  'dependency_error_rate',
  'availability_rate',
] as const satisfies readonly KpiId[];

const dataIds = ['initial_plans_count', 'manual_recipes_count', 'adherence_rate'] as const satisfies readonly KpiId[];

function observed(kpi_id: KpiId, value = 1): KpiResult {
  return {
    kpi_id,
    value,
    quality: 'observed',
    reason: null,
    sample_count: value,
    measured_at: context.window_end,
  };
}

function unavailable(kpi_id: KpiId, reason = 'SOURCE_UNAVAILABLE'): KpiResult {
  return {
    kpi_id,
    value: null,
    quality: 'unavailable',
    reason,
    sample_count: 0,
    measured_at: context.window_end,
  };
}

function loggerFor(results: readonly KpiResult[]) {
  return { collect: jest.fn().mockResolvedValue(results) };
}

describe('CompositeKpiLogger', () => {
  it('combines exactly the eight telemetry and three business KPIs in deterministic kpi_id order', async () => {
    const telemetry = { collect: jest.fn().mockResolvedValue(telemetryIds.map((id) => observed(id))) };
    const data = { collect: jest.fn().mockResolvedValue(dataIds.map((id) => observed(id))) };
    const logger = new CompositeKpiLogger(telemetry, data);

    await expect(logger.collect(context)).resolves.toEqual([
      ...[...telemetryIds, ...dataIds].sort().map((id) => observed(id)),
    ]);
    expect(telemetry.collect).toHaveBeenCalledWith(context);
    expect(data.collect).toHaveBeenCalledWith(context);
  });

  it('composes the NUT-85 TelemetryLogger implementation with the business logger', async () => {
    const reader = { loadAggregates: jest.fn(async () => sampleAggregates(new Date(context.window_end))) };
    const telemetry = new TelemetryLogger(reader, { environment: 'qa' }, () => new Date('2026-10-10T00:00:01.000Z'));
    const data = loggerFor(dataIds.map((id) => observed(id)));

    const results = await new CompositeKpiLogger(telemetry, data).collect(context);

    expect(results).toHaveLength(11);
    expect(results.map((result) => result.kpi_id)).toEqual([...telemetryIds, ...dataIds].sort());
    expect(reader.loadAggregates).toHaveBeenCalledTimes(1);
  });

  it('maps an expected telemetry source failure to all eight unavailable technical IDs while retaining observed business values', async () => {
    const telemetry = { collect: jest.fn().mockRejectedValue({ code: 'SOURCE_UNAVAILABLE' }) };
    const data = loggerFor(dataIds.map((id) => observed(id, 0)));

    await expect(new CompositeKpiLogger(telemetry, data, () => new Date(context.window_end)).collect(context)).resolves.toEqual([
      ...telemetryIds.map((id) => unavailable(id)),
      ...dataIds.map((id) => observed(id, 0)),
    ].sort((left, right) => left.kpi_id.localeCompare(right.kpi_id)));
  });

  it('maps an expected data source failure to all three unavailable business IDs while retaining observed telemetry values', async () => {
    const telemetry = loggerFor(telemetryIds.map((id) => observed(id, 0)));
    const data = { collect: jest.fn().mockRejectedValue({ code: 'SOURCE_UNAVAILABLE' }) };

    await expect(new CompositeKpiLogger(telemetry, data, () => new Date(context.window_end)).collect(context)).resolves.toEqual([
      ...telemetryIds.map((id) => observed(id, 0)),
      ...dataIds.map((id) => id === 'adherence_rate'
        ? {
            ...unavailable(id),
            evidence: {
              numerator: null,
              denominator: null,
              quality: 'unavailable',
              reason: 'SOURCE_UNAVAILABLE',
              collection_date: '2026-10-09',
              measured_at: context.window_end,
              environment: 'qa',
            },
          }
        : unavailable(id)),
    ].sort((left, right) => left.kpi_id.localeCompare(right.kpi_id)));
  });

  it('preserves unknown adherence counts and local collection context when the complete data source fails', async () => {
    const telemetry = loggerFor(telemetryIds.map((id) => observed(id, 0)));
    const data = { collect: jest.fn().mockRejectedValue({ code: 'SOURCE_UNAVAILABLE' }) };
    const clockInstant = new Date('2026-10-10T02:30:00.000Z');
    const results = await new CompositeKpiLogger(telemetry, data, () => clockInstant).collect(context);
    const businessResults = results.filter(({ kpi_id }) => dataIds.includes(kpi_id as typeof dataIds[number]));
    const adherence = results.find(({ kpi_id }) => kpi_id === 'adherence_rate');

    expect(businessResults).toHaveLength(3);
    for (const result of businessResults) {
      expect(result).toMatchObject({ value: null, quality: 'unavailable', reason: 'SOURCE_UNAVAILABLE' });
    }
    expect(adherence).toMatchObject({
      kpi_id: 'adherence_rate',
      value: null,
      quality: 'unavailable',
      reason: 'SOURCE_UNAVAILABLE',
      sample_count: 0,
      measured_at: clockInstant.toISOString(),
      evidence: {
        numerator: null,
        denominator: null,
        quality: 'unavailable',
        reason: 'SOURCE_UNAVAILABLE',
        collection_date: '2026-10-09',
        measured_at: clockInstant.toISOString(),
        environment: 'qa',
      },
    });
  });

  it('preserves the other business results when only adherence is unavailable', async () => {
    const telemetry = loggerFor(telemetryIds.map((id) => observed(id, 0)));
    const data = loggerFor([
      observed('initial_plans_count', 2),
      observed('manual_recipes_count', 3),
      unavailable('adherence_rate', 'SOURCE_UNAVAILABLE'),
    ]);

    const results = await new CompositeKpiLogger(telemetry, data).collect(context);

    expect(results).toHaveLength(11);
    expect(results.find(({ kpi_id }) => kpi_id === 'adherence_rate')).toMatchObject({
      value: null, quality: 'unavailable', reason: 'SOURCE_UNAVAILABLE',
    });
    expect(results.find(({ kpi_id }) => kpi_id === 'initial_plans_count')).toMatchObject({ value: 2, quality: 'observed' });
    expect(results.find(({ kpi_id }) => kpi_id === 'manual_recipes_count')).toMatchObject({ value: 3, quality: 'observed' });
  });

  it.each([
    ['duplicate', [...telemetryIds.map((id) => observed(id)), observed('operations_count')], dataIds.map((id) => observed(id)), /duplicate/i],
    ['missing', telemetryIds.slice(1).map((id) => observed(id)), dataIds.map((id) => observed(id)), /missing/i],
    ['unknown', [...telemetryIds.map((id) => observed(id)), { ...observed('operations_count'), kpi_id: 'not_a_kpi' }], dataIds.map((id) => observed(id)), /unknown/i],
    ['NaN', telemetryIds.map((id) => id === 'error_rate' ? observed(id, Number.NaN) : observed(id)), dataIds.map((id) => observed(id)), /finite|NaN/i],
    ['Infinity', telemetryIds.map((id) => id === 'error_rate' ? observed(id, Number.POSITIVE_INFINITY) : observed(id)), dataIds.map((id) => observed(id)), /finite|infinity/i],
    ['invalid shape', telemetryIds.map((id) => id === 'error_rate' ? { ...observed(id), sample_count: -1 } : observed(id)), dataIds.map((id) => observed(id)), /sample_count|shape|invalid/i],
    ['invalid timestamp', telemetryIds.map((id) => id === 'error_rate' ? { ...observed(id), measured_at: 'not-a-timestamp' } : observed(id)), dataIds.map((id) => observed(id)), /measured_at|timestamp|date/i],
    ['incoherent unavailable value', telemetryIds.map((id) => id === 'error_rate' ? { ...unavailable(id), value: 0 } : observed(id)), dataIds.map((id) => observed(id)), /quality|unavailable|value/i],
  ])('rejects a structurally invalid %s collector payload instead of defaulting it', async (_kind, telemetryResults, dataResults, error) => {
    const telemetry = loggerFor(telemetryResults as readonly KpiResult[]);
    const data = loggerFor(dataResults as readonly KpiResult[]);

    await expect(new CompositeKpiLogger(telemetry, data).collect(context)).rejects.toThrow(error);
  });

  it('does not disguise a programming error as an unavailable source result', async () => {
    const telemetry = { collect: jest.fn().mockRejectedValue(new TypeError('programmer bug')) };
    const data = loggerFor(dataIds.map((id) => observed(id)));

    await expect(new CompositeKpiLogger(telemetry, data).collect(context)).rejects.toThrow('programmer bug');
  });
});
