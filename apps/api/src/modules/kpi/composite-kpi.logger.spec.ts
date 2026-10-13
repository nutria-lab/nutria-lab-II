import { CompositeKpiLogger } from './composite-kpi.logger';
import type { CollectionContext, KpiId, KpiResult } from './kpi-contract';

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

const dataIds = ['initial_plans_count', 'manual_recipes_count'] as const satisfies readonly KpiId[];

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
  it('combines exactly the eight telemetry and two business KPIs in deterministic kpi_id order', async () => {
    const telemetry = { collect: jest.fn().mockResolvedValue(telemetryIds.map((id) => observed(id))) };
    const data = { collect: jest.fn().mockResolvedValue(dataIds.map((id) => observed(id))) };
    const logger = new CompositeKpiLogger(telemetry, data);

    await expect(logger.collect(context)).resolves.toEqual([
      ...[...telemetryIds, ...dataIds].sort().map((id) => observed(id)),
    ]);
    expect(telemetry.collect).toHaveBeenCalledWith(context);
    expect(data.collect).toHaveBeenCalledWith(context);
  });

  it('maps an expected telemetry source failure to all eight unavailable technical IDs while retaining observed business values', async () => {
    const telemetry = { collect: jest.fn().mockRejectedValue({ code: 'SOURCE_UNAVAILABLE' }) };
    const data = loggerFor(dataIds.map((id) => observed(id, 0)));

    await expect(new CompositeKpiLogger(telemetry, data).collect(context)).resolves.toEqual([
      ...telemetryIds.map((id) => unavailable(id)),
      ...dataIds.map((id) => observed(id, 0)),
    ].sort((left, right) => left.kpi_id.localeCompare(right.kpi_id)));
  });

  it('maps an expected data source failure to both unavailable business IDs while retaining observed telemetry values', async () => {
    const telemetry = loggerFor(telemetryIds.map((id) => observed(id, 0)));
    const data = { collect: jest.fn().mockRejectedValue({ code: 'SOURCE_UNAVAILABLE' }) };

    await expect(new CompositeKpiLogger(telemetry, data).collect(context)).resolves.toEqual([
      ...telemetryIds.map((id) => observed(id, 0)),
      ...dataIds.map((id) => unavailable(id)),
    ].sort((left, right) => left.kpi_id.localeCompare(right.kpi_id)));
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
