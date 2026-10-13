import type {
  CollectionContext,
  FrozenBatch,
  KpiEnvironment,
  KpiId,
  KpiLogger,
  KpiResult,
  Measurement,
} from './kpi-contract';

describe('KPI contract v1', () => {
  it('defines the closed shared contract used by every KPI collector and publisher boundary', async () => {
    const environment: KpiEnvironment = 'qa';
    const ids: readonly KpiId[] = [
      'operations_count',
      'error_rate',
      'latency_p95_ms',
      'health_status',
      'last_success_age_seconds',
      'timeout_rate',
      'dependency_error_rate',
      'availability_rate',
      'initial_plans_count',
      'manual_recipes_count',
    ];
    const context: CollectionContext = {
      contract_version: '1',
      date: '2026-10-09',
      environment,
      window_start: '2026-10-09T03:00:00.000Z',
      window_end: '2026-10-10T00:00:00.000Z',
      run_id: 'run-86',
    };
    const result: KpiResult = {
      kpi_id: 'initial_plans_count',
      value: 0,
      quality: 'observed',
      reason: null,
      sample_count: 0,
      measured_at: '2026-10-10T00:00:00.000Z',
    };
    const logger: KpiLogger = { collect: async () => [result] };
    const measurement: Measurement = {
      kpi_id: result.kpi_id,
      date: context.date,
      env: context.environment,
      value: result.value ?? 0,
      run_id: context.run_id,
    };
    const batch: FrozenBatch = {
      contract_version: '1',
      context,
      measurements: [measurement],
      diagnostics: [{ kpi_id: result.kpi_id, quality: 'observed', reason: null, sample_count: 0 }],
      payload_sha256: 'a'.repeat(64),
    };

    expect(ids).toHaveLength(10);
    await expect(logger.collect(context)).resolves.toEqual([result]);
    expect(batch.measurements[0]).toEqual(measurement);
  });
});
