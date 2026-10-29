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
  | 'manual_recipes_count'
  | 'adherence_rate';

/** Current publication contract. The legacy set remains readable for frozen retries only. */
export const ALL_KPI_IDS = [
  'operations_count', 'error_rate', 'latency_p95_ms', 'health_status',
  'last_success_age_seconds', 'timeout_rate', 'dependency_error_rate', 'availability_rate',
  'initial_plans_count', 'manual_recipes_count', 'adherence_rate',
] as const satisfies readonly KpiId[];

export const LEGACY_KPI_IDS = [
  'operations_count', 'error_rate', 'latency_p95_ms', 'health_status',
  'last_success_age_seconds', 'timeout_rate', 'dependency_error_rate', 'availability_rate',
  'initial_plans_count', 'manual_recipes_count',
] as const satisfies readonly KpiId[];

export interface AdherenceEvidence {
  numerator: number | null;
  denominator: number | null;
  quality: 'observed' | 'unavailable';
  reason: string | null;
  collection_date: string;
  measured_at: string;
  environment: KpiEnvironment;
}

/** Accepts only the aggregate fields approved for frozen KPI evidence. */
export function isAdherenceEvidence(value: unknown): value is AdherenceEvidence {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const evidence = value as Record<string, unknown>;
  const keys = Object.keys(evidence).sort();
  if (keys.join(',') !== 'collection_date,denominator,environment,measured_at,numerator,quality,reason' ||
    (evidence.quality !== 'observed' && evidence.quality !== 'unavailable') ||
    !(evidence.reason === null || (typeof evidence.reason === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(evidence.reason))) ||
    typeof evidence.collection_date !== 'string' || !isCivilDate(evidence.collection_date) ||
    typeof evidence.measured_at !== 'string' || !isIsoTimestamp(evidence.measured_at) ||
    (evidence.environment !== 'dev' && evidence.environment !== 'qa' && evidence.environment !== 'prod')) return false;

  const unknownCounts = evidence.numerator === null && evidence.denominator === null;
  const validCounts = Number.isSafeInteger(evidence.numerator) && Number.isSafeInteger(evidence.denominator) &&
    (evidence.numerator as number) >= 0 && (evidence.denominator as number) >= 0 &&
    (evidence.numerator as number) <= (evidence.denominator as number);
  if (!unknownCounts && !validCounts) return false;
  if (evidence.quality === 'observed') {
    return evidence.reason === null && validCounts && (evidence.denominator as number) > 0;
  }
  if (unknownCounts) return evidence.reason === 'SOURCE_UNAVAILABLE';
  return evidence.reason === 'NO_ELIGIBLE_MEALS' && evidence.numerator === 0 && evidence.denominator === 0;
}

function isCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

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
  evidence?: AdherenceEvidence;
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
  measurements: readonly Measurement[]; // contrato actual de once, ordenados por kpi_id; legacy congelado conserva diez
  diagnostics: readonly {
    kpi_id: KpiId;
    quality: 'observed' | 'defaulted';
    reason: string | null;
    sample_count: number;
    evidence?: AdherenceEvidence;
  }[];
  payload_sha256: string;
}
