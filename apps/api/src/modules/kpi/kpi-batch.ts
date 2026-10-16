import { createHash } from 'node:crypto';

import type { CollectionContext, FrozenBatch, KpiResult, Measurement } from './kpi-contract';

/** Produces the exact UTF-8 payload whose digest is persisted and published. */
export function canonicalPayloadBytes(measurements: readonly Measurement[]): Buffer {
  return Buffer.from(JSON.stringify(measurements), 'utf8');
}

/** Normalizes collector results into an immutable, reproducible publication batch. */
export function freezeBatch(context: CollectionContext, results: readonly KpiResult[]): FrozenBatch {
  const ordered = [...results].sort((left, right) => compareKpiId(left.kpi_id, right.kpi_id));
  const measurements = ordered.map((result) => toMeasurement(context, result));
  const diagnostics = ordered.map((result) => ({
    kpi_id: result.kpi_id,
    quality: result.quality === 'unavailable' ? 'defaulted' as const : 'observed' as const,
    reason: result.reason,
    sample_count: result.sample_count,
  }));
  const bytes = canonicalPayloadBytes(measurements);

  return {
    contract_version: '1',
    context,
    measurements,
    diagnostics,
    payload_sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function compareKpiId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toMeasurement(context: CollectionContext, result: KpiResult): Measurement {
  return {
    kpi_id: result.kpi_id,
    date: context.date,
    env: context.environment,
    value: result.value ?? 0,
    run_id: context.run_id,
  };
}
