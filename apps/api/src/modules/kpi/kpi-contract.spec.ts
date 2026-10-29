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
      'adherence_rate',
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
      kpi_id: 'adherence_rate',
      value: 80,
      quality: 'observed',
      reason: null,
      sample_count: 40,
      measured_at: '2026-10-10T00:00:00.000Z',
      evidence: {
        numerator: 32,
        denominator: 40,
        quality: 'observed',
        reason: null,
        collection_date: '2026-10-10',
        measured_at: '2026-10-10T00:00:00.000Z',
        environment,
      },
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
      diagnostics: [{ kpi_id: result.kpi_id, quality: 'observed', reason: null, sample_count: 40, evidence: result.evidence }],
      payload_sha256: 'a'.repeat(64),
    };

    expect(ids).toHaveLength(11);
    await expect(logger.collect(context)).resolves.toEqual([result]);
    expect(batch.measurements[0]).toEqual(measurement);
    expect(batch.diagnostics[0]).toMatchObject({ evidence: expect.objectContaining({ numerator: 32, denominator: 40 }) });
  });
});
