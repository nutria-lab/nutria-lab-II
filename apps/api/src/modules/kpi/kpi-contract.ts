// Versión mínima del contrato compartido v1 (tipos textuales del ticket); la implementación es de Lara.

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
  date: string; // YYYY-MM-DD en Argentina
  environment: KpiEnvironment;
  window_start: string; // ISO UTC
  window_end: string; // ISO UTC, corte fijo
  run_id: string; // UUID de la publicacion; no el ID numerico de Actions
}

export interface KpiResult {
  kpi_id: KpiId;
  value: number | null;
  quality: 'observed' | 'unavailable';
  reason: string | null; // codigo tecnico corto, sin datos personales
  sample_count: number;
  measured_at: string; // ISO UTC real del calculo
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
  measurements: readonly Measurement[]; // exactamente diez, ordenados por kpi_id
  diagnostics: readonly {
    kpi_id: KpiId;
    quality: 'observed' | 'defaulted';
    reason: string | null;
    sample_count: number;
  }[];
  payload_sha256: string;
}
