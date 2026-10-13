/** The versioned boundary shared by every KPI collector and publisher. */
export type KpiEnvironment = 'dev' | 'qa' | 'prod';

export type KpiId =
  | 'operations_count'
  | 'error_rate'
  | 'latency_p95_ms'
  | 'health_status'
  | 'last_success_age_seconds'
  | 'timeout_rate'
  | 'dependency_error_rate'
  | 'availability_rate'
  | 'initial_plans_count'
  | 'manual_recipes_count';

export interface CollectionContext {
  contract_version: '1';
  date: string;
  environment: KpiEnvironment;
  window_start: string;
  window_end: string;
  run_id: string;
}

export interface KpiResult {
  kpi_id: KpiId;
  value: number | null;
  quality: 'observed' | 'unavailable';
  reason: string | null;
  sample_count: number;
  measured_at: string;
}

export interface KpiLogger {
  collect(context: CollectionContext): Promise<readonly KpiResult[]>;
}

export interface Measurement {
  kpi_id: KpiId;
  date: string;
  env: KpiEnvironment;
  value: number;
  run_id: string;
}

export interface FrozenBatch {
  contract_version: '1';
  context: CollectionContext;
  measurements: readonly Measurement[];
  diagnostics: readonly {
    kpi_id: KpiId;
    quality: 'observed' | 'defaulted';
    reason: string | null;
    sample_count: number;
  }[];
  payload_sha256: string;
}
