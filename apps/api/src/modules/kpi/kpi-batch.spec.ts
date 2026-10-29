import { createHash } from 'node:crypto';
import { canonicalPayloadBytes, freezeBatch } from './kpi-batch';
import type { CollectionContext, KpiId, KpiResult } from './kpi-contract';

const context: CollectionContext = {
  contract_version: '1',
  date: '2026-10-09',
  environment: 'prod',
  window_start: '2026-10-09T03:00:00.000Z',
  window_end: '2026-10-10T00:00:00.000Z',
  run_id: 'stable-run-id',
};

const currentIds: readonly KpiId[] = [
  'operations_count', 'error_rate', 'latency_p95_ms', 'health_status',
  'last_success_age_seconds', 'timeout_rate', 'dependency_error_rate', 'availability_rate',
  'initial_plans_count', 'manual_recipes_count', 'adherence_rate',
];

function result(kpi_id: KpiId, value: number | null, quality: 'observed' | 'unavailable' = 'observed'): KpiResult {
  return {
    kpi_id,
    value,
    quality,
    reason: quality === 'unavailable' ? 'SOURCE_UNAVAILABLE' : null,
    sample_count: value ?? 0,
    measured_at: context.window_end,
  };
}

describe('KPI batch freezing', () => {
  it('normalizes input order, preserves observed zero, and distinguishes an unavailable defaulted zero in diagnostics', () => {
    const batch = freezeBatch(context, [
      result('manual_recipes_count', null, 'unavailable'),
      result('availability_rate', 0),
      result('initial_plans_count', 0),
    ]);

    expect(batch.measurements).toEqual([
      { kpi_id: 'availability_rate', date: context.date, env: context.environment, value: 0, run_id: context.run_id },
      { kpi_id: 'initial_plans_count', date: context.date, env: context.environment, value: 0, run_id: context.run_id },
      { kpi_id: 'manual_recipes_count', date: context.date, env: context.environment, value: 0, run_id: context.run_id },
    ]);
    expect(batch.diagnostics).toEqual([
      { kpi_id: 'availability_rate', quality: 'observed', reason: null, sample_count: 0 },
      { kpi_id: 'initial_plans_count', quality: 'observed', reason: null, sample_count: 0 },
      { kpi_id: 'manual_recipes_count', quality: 'defaulted', reason: 'SOURCE_UNAVAILABLE', sample_count: 0 },
    ]);
  });

  it('emits exactly the canonical UTF-8 JSON bytes used to calculate the frozen SHA-256', () => {
    const batch = freezeBatch(context, [result('manual_recipes_count', 4), result('availability_rate', 0)]);
    const bytes = canonicalPayloadBytes(batch.measurements);

    expect(bytes).toEqual(Buffer.from(
      '[{"kpi_id":"availability_rate","date":"2026-10-09","env":"prod","value":0,"run_id":"stable-run-id"},{"kpi_id":"manual_recipes_count","date":"2026-10-09","env":"prod","value":4,"run_id":"stable-run-id"}]',
      'utf8',
    ));
    expect(batch.payload_sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('orders the full contract by deterministic codepoint kpi_id order', () => {
    const ids: readonly KpiId[] = [
      'operations_count', 'error_rate', 'latency_p95_ms', 'health_status',
      'last_success_age_seconds', 'timeout_rate', 'dependency_error_rate', 'availability_rate',
      'initial_plans_count', 'manual_recipes_count',
    ];
    const batch = freezeBatch(context, [...ids].reverse().map(id => result(id, 0)));

    expect(batch.measurements.map(item => item.kpi_id)).toEqual([...ids].sort());
  });

  it('freezes all eleven measurements and keeps adherence numerator, denominator, and collection context in diagnostics', () => {
    const evidence = {
      numerator: 32,
      denominator: 40,
      quality: 'observed' as const,
      reason: null,
      collection_date: '2026-10-29',
      measured_at: '2026-10-29T03:00:00.000Z',
      environment: 'prod' as const,
    };
    const results = currentIds.map((kpi_id) => kpi_id === 'adherence_rate'
      ? {
          ...result(kpi_id, 80),
          sample_count: 40,
          evidence,
        }
      : result(kpi_id, 0));

    const batch = freezeBatch(context, results);
    const adherence = batch.diagnostics.find(({ kpi_id }) => kpi_id === 'adherence_rate');

    expect(batch.measurements).toHaveLength(11);
    expect(batch.measurements.map(({ kpi_id }) => kpi_id)).toEqual([...currentIds].sort());
    expect(adherence).toMatchObject({ kpi_id: 'adherence_rate', sample_count: 40, evidence });
    expect(canonicalPayloadBytes(batch.measurements).toString('utf8')).not.toContain('numerator');
  });

  it('does not enrich a previously frozen ten-result batch with the new KPI', () => {
    const legacyIds = currentIds.filter((id) => id !== 'adherence_rate');
    const batch = freezeBatch(context, legacyIds.map((id) => result(id, 0)));

    expect(batch.measurements).toHaveLength(10);
    expect(batch.measurements.some(({ kpi_id }) => kpi_id === 'adherence_rate')).toBe(false);
    expect(batch.diagnostics.some(({ kpi_id }) => kpi_id === 'adherence_rate')).toBe(false);
  });

  it('is stable for the same logical batch regardless of input order, and changes when a value changes', () => {
    const first = freezeBatch(context, [result('manual_recipes_count', 4), result('availability_rate', 0)]);
    const reordered = freezeBatch(context, [result('availability_rate', 0), result('manual_recipes_count', 4)]);
    const changed = freezeBatch(context, [result('availability_rate', 0), result('manual_recipes_count', 5)]);

    expect(reordered).toEqual(first);
    expect(changed.payload_sha256).not.toBe(first.payload_sha256);
    expect(canonicalPayloadBytes(first.measurements)).toEqual(canonicalPayloadBytes(reordered.measurements));
  });
});
