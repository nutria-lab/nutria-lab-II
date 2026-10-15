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

  it('is stable for the same logical batch regardless of input order, and changes when a value changes', () => {
    const first = freezeBatch(context, [result('manual_recipes_count', 4), result('availability_rate', 0)]);
    const reordered = freezeBatch(context, [result('availability_rate', 0), result('manual_recipes_count', 4)]);
    const changed = freezeBatch(context, [result('availability_rate', 0), result('manual_recipes_count', 5)]);

    expect(reordered).toEqual(first);
    expect(changed.payload_sha256).not.toBe(first.payload_sha256);
    expect(canonicalPayloadBytes(first.measurements)).toEqual(canonicalPayloadBytes(reordered.measurements));
  });
});
