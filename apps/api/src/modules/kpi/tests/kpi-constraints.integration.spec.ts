// NUT-85 T1 — A2 (comportamiento real de los CHECK/UNIQUE) y base de F7 (NaN/Infinity).
// Integración contra Postgres real: sólo KPI_TEST_DATABASE_URL, skip si falta, falla si el host no es local.
// Cada caso inválido viola UNA sola regla (salvo donde se indica más de un nombre aceptable).
import { randomUUID } from 'crypto';
import {
  DisposableSchema,
  KpiTable,
  TELEMETRY_KPI_IDS,
  applyMigrations,
  capturePgError,
  createDisposableSchema,
  describeIfKpiDb,
  findKpiMigrationDirs,
} from './kpi-test-db.fixture';

jest.setTimeout(60_000);

type Row = Record<string, unknown>;

const HALF_HOUR_MS = 30 * 60 * 1000;
const BASE_BUCKET_MS = Date.parse('2026-10-09T12:00:00.000Z');
const BASE_WINDOW_START = '2026-10-09T03:00:00.000Z';
const BASE_WINDOW_END_MS = Date.parse('2026-10-10T00:00:00.000Z');
const BASE_REPORT_DAY_MS = Date.parse('2026-01-01T00:00:00.000Z');
const HASH = 'a'.repeat(64);
const BATCH = JSON.stringify({ rows: [{ kpi_id: 'operations_count', value: 1 }] });

// Contador para que las filas válidas no choquen con las UNIQUE.
let sequence = 0;
const next = (): number => ++sequence;

const iso = (ms: number): string => new Date(ms).toISOString();

const ROW_FACTORIES: Record<KpiTable, () => Row> = {
  kpi_http_event: () => ({
    id: randomUUID(),
    environment: 'dev',
    operation: 'GET /meal-plans/:planId',
    started_at: '2026-10-09T12:00:00.000Z',
    finished_at: '2026-10-09T12:00:00.250Z',
    duration_ms: 250,
    http_status: 200,
    outcome: 'success',
  }),
  kpi_dependency_event: () => ({
    id: randomUUID(),
    environment: 'dev',
    operation_id: randomUUID(),
    dependency: 'gemini',
    attempt: 1,
    started_at: '2026-10-09T12:00:00.000Z',
    finished_at: '2026-10-09T12:00:01.500Z',
    duration_ms: 1500,
    outcome: 'success',
  }),
  kpi_health_sample: () => {
    const scheduled = BASE_BUCKET_MS + next() * HALF_HOUR_MS;
    return {
      id: randomUUID(),
      environment: 'dev',
      scheduled_for: iso(scheduled),
      measured_at: iso(scheduled + 3120),
      api_ok: true,
      database_ok: true,
      outcome: 'healthy',
      reason: null,
    };
  },
  kpi_snapshot: () => ({
    id: randomUUID(),
    environment: 'dev',
    report_date: '2026-10-09',
    window_start: BASE_WINDOW_START,
    window_end: iso(BASE_WINDOW_END_MS - next() * 60_000),
    snapshot_kind: 'preview',
    kpi_id: 'operations_count',
    value: 10,
    quality: 'observed',
    reason: null,
    sample_count: 10,
    measured_at: '2026-10-09T23:00:00.000Z',
  }),
  kpi_publication: () => ({
    run_id: randomUUID(),
    environment: 'dev',
    report_date: iso(BASE_REPORT_DAY_MS + next() * 86_400_000).slice(0, 10),
    window_start: BASE_WINDOW_START,
    window_end: iso(BASE_WINDOW_END_MS),
    status: 'preparing',
    frozen_batch: null,
    payload_sha256: null,
    source_commit: 'abc1234',
    retry_chain_id: randomUUID(),
    attempt_count: 0,
    last_error: null,
    accepted_at: null,
    delivered_at: null,
  }),
};

function buildInsert(table: KpiTable, row: Row): { sql: string; params: unknown[] } {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  return {
    sql: `INSERT INTO "${table}" (${columns.map(column => `"${column}"`).join(', ')}) VALUES (${placeholders.join(', ')})`,
    params: columns.map(column => row[column]),
  };
}

interface InvalidCase {
  rule: string;
  table: KpiTable;
  overrides: Row;
  /** Nombre(s) de constraint aceptable(s) para el rechazo. */
  constraint: string | string[];
}

interface ValidCase {
  rule: string;
  table: KpiTable;
  overrides: Row;
}

const terminalAt = (ms: number) => ({ finished_at: iso(Date.parse('2026-10-09T12:00:00.000Z') + ms), duration_ms: ms });
const PENDING = { outcome: 'pending', finished_at: null, duration_ms: null };

const INVALID_CASES: InvalidCase[] = [
  // ----- kpi_http_event -----
  { rule: 'http: environment fuera de dev/qa/prod', table: 'kpi_http_event', overrides: { environment: 'production' }, constraint: 'kpi_http_event_environment_check' },
  { rule: 'http: environment con mayúsculas', table: 'kpi_http_event', overrides: { environment: 'PROD' }, constraint: 'kpi_http_event_environment_check' },
  { rule: 'http: outcome desconocido', table: 'kpi_http_event', overrides: { outcome: 'cancelled', http_status: null }, constraint: 'kpi_http_event_outcome_check' },
  { rule: 'http: operation vacía', table: 'kpi_http_event', overrides: { operation: '' }, constraint: 'kpi_http_event_operation_length_check' },
  { rule: 'http: operation de 201 caracteres', table: 'kpi_http_event', overrides: { operation: 'x'.repeat(201) }, constraint: 'kpi_http_event_operation_length_check' },
  { rule: 'http: duration_ms negativa', table: 'kpi_http_event', overrides: { duration_ms: -1 }, constraint: 'kpi_http_event_duration_check' },
  { rule: 'http: duration_ms Infinity', table: 'kpi_http_event', overrides: { duration_ms: 'Infinity' }, constraint: 'kpi_http_event_duration_check' },
  { rule: 'http: duration_ms NaN', table: 'kpi_http_event', overrides: { duration_ms: 'NaN' }, constraint: 'kpi_http_event_duration_check' },
  { rule: 'http: http_status 99', table: 'kpi_http_event', overrides: { outcome: 'other', http_status: 99 }, constraint: 'kpi_http_event_http_status_range_check' },
  { rule: 'http: http_status 600', table: 'kpi_http_event', overrides: { outcome: 'other', http_status: 600 }, constraint: 'kpi_http_event_http_status_range_check' },
  { rule: 'http: finished_at < started_at', table: 'kpi_http_event', overrides: { finished_at: '2026-10-09T11:59:59.999Z', duration_ms: 0 }, constraint: 'kpi_http_event_finished_after_started_check' },
  { rule: 'http: pending con finished_at y duration_ms', table: 'kpi_http_event', overrides: { ...PENDING, http_status: null, ...terminalAt(10) }, constraint: 'kpi_http_event_lifecycle_check' },
  { rule: 'http: pending con duration_ms', table: 'kpi_http_event', overrides: { ...PENDING, http_status: null, duration_ms: 5 }, constraint: 'kpi_http_event_lifecycle_check' },
  { rule: 'http: pending con http_status', table: 'kpi_http_event', overrides: { ...PENDING, http_status: 200 }, constraint: ['kpi_http_event_lifecycle_check', 'kpi_http_event_status_by_outcome_check'] },
  { rule: 'http: terminal sin finished_at', table: 'kpi_http_event', overrides: { finished_at: null }, constraint: 'kpi_http_event_lifecycle_check' },
  { rule: 'http: terminal sin duration_ms', table: 'kpi_http_event', overrides: { duration_ms: null }, constraint: 'kpi_http_event_lifecycle_check' },
  { rule: 'http: timeout sin finished_at', table: 'kpi_http_event', overrides: { outcome: 'timeout', http_status: null, finished_at: null }, constraint: 'kpi_http_event_lifecycle_check' },
  { rule: 'http: success con 404', table: 'kpi_http_event', overrides: { outcome: 'success', http_status: 404 }, constraint: 'kpi_http_event_status_by_outcome_check' },
  { rule: 'http: success con 302', table: 'kpi_http_event', overrides: { outcome: 'success', http_status: 302 }, constraint: 'kpi_http_event_status_by_outcome_check' },
  { rule: 'http: client_error con 200', table: 'kpi_http_event', overrides: { outcome: 'client_error', http_status: 200 }, constraint: 'kpi_http_event_status_by_outcome_check' },
  { rule: 'http: client_error con 500', table: 'kpi_http_event', overrides: { outcome: 'client_error', http_status: 500 }, constraint: 'kpi_http_event_status_by_outcome_check' },
  { rule: 'http: server_error con 404', table: 'kpi_http_event', overrides: { outcome: 'server_error', http_status: 404 }, constraint: 'kpi_http_event_status_by_outcome_check' },

  // ----- kpi_dependency_event -----
  { rule: 'dependency: environment inválido', table: 'kpi_dependency_event', overrides: { environment: 'staging' }, constraint: 'kpi_dependency_event_environment_check' },
  { rule: 'dependency: outcome HTTP no válido para dependencias', table: 'kpi_dependency_event', overrides: { outcome: 'client_error' }, constraint: 'kpi_dependency_event_outcome_check' },
  { rule: 'dependency: attempt 0', table: 'kpi_dependency_event', overrides: { attempt: 0 }, constraint: 'kpi_dependency_event_attempt_check' },
  { rule: 'dependency: attempt negativo', table: 'kpi_dependency_event', overrides: { attempt: -1 }, constraint: 'kpi_dependency_event_attempt_check' },
  { rule: 'dependency: dependency vacía', table: 'kpi_dependency_event', overrides: { dependency: '' }, constraint: 'kpi_dependency_event_dependency_length_check' },
  { rule: 'dependency: dependency de 65 caracteres', table: 'kpi_dependency_event', overrides: { dependency: 'd'.repeat(65) }, constraint: 'kpi_dependency_event_dependency_length_check' },
  { rule: 'dependency: duration_ms negativa', table: 'kpi_dependency_event', overrides: { duration_ms: -0.5 }, constraint: 'kpi_dependency_event_duration_check' },
  { rule: 'dependency: duration_ms Infinity', table: 'kpi_dependency_event', overrides: { duration_ms: 'Infinity' }, constraint: 'kpi_dependency_event_duration_check' },
  { rule: 'dependency: duration_ms NaN', table: 'kpi_dependency_event', overrides: { duration_ms: 'NaN' }, constraint: 'kpi_dependency_event_duration_check' },
  { rule: 'dependency: finished_at < started_at', table: 'kpi_dependency_event', overrides: { finished_at: '2026-10-09T11:00:00.000Z', duration_ms: 0 }, constraint: 'kpi_dependency_event_finished_after_started_check' },
  { rule: 'dependency: pending con finished_at y duration_ms', table: 'kpi_dependency_event', overrides: { outcome: 'pending' }, constraint: 'kpi_dependency_event_lifecycle_check' },
  { rule: 'dependency: terminal sin finished_at', table: 'kpi_dependency_event', overrides: { outcome: 'error', finished_at: null }, constraint: 'kpi_dependency_event_lifecycle_check' },
  { rule: 'dependency: terminal sin duration_ms', table: 'kpi_dependency_event', overrides: { outcome: 'timeout', duration_ms: null }, constraint: 'kpi_dependency_event_lifecycle_check' },

  // ----- kpi_health_sample -----
  { rule: 'health: environment inválido', table: 'kpi_health_sample', overrides: { environment: 'local' }, constraint: 'kpi_health_sample_environment_check' },
  { rule: 'health: outcome desconocido', table: 'kpi_health_sample', overrides: { outcome: 'degraded' }, constraint: 'kpi_health_sample_outcome_check' },
  { rule: 'health: healthy con api_ok false', table: 'kpi_health_sample', overrides: { outcome: 'healthy', api_ok: false }, constraint: 'kpi_health_sample_healthy_check' },
  { rule: 'health: healthy con database_ok NULL', table: 'kpi_health_sample', overrides: { outcome: 'healthy', database_ok: null }, constraint: 'kpi_health_sample_healthy_check' },
  { rule: 'health: unhealthy con ambos true', table: 'kpi_health_sample', overrides: { outcome: 'unhealthy', api_ok: true, database_ok: true }, constraint: 'kpi_health_sample_unhealthy_check' },
  { rule: 'health: unhealthy sin ningún false', table: 'kpi_health_sample', overrides: { outcome: 'unhealthy', api_ok: null, database_ok: true }, constraint: 'kpi_health_sample_unhealthy_check' },
  { rule: 'health: unknown con un false (eso es unhealthy)', table: 'kpi_health_sample', overrides: { outcome: 'unknown', api_ok: null, database_ok: false }, constraint: 'kpi_health_sample_unknown_check' },
  { rule: 'health: unknown con ambos true (eso es healthy)', table: 'kpi_health_sample', overrides: { outcome: 'unknown', api_ok: true, database_ok: true }, constraint: 'kpi_health_sample_unknown_check' },
  { rule: 'health: scheduled_for no alineado (12:15)', table: 'kpi_health_sample', overrides: { scheduled_for: '2026-09-01T12:15:00.000Z', measured_at: '2026-09-01T12:15:01.000Z' }, constraint: 'kpi_health_sample_scheduled_alignment_check' },
  { rule: 'health: scheduled_for no alineado (milisegundos)', table: 'kpi_health_sample', overrides: { scheduled_for: '2026-09-01T12:00:00.500Z', measured_at: '2026-09-01T12:00:01.000Z' }, constraint: 'kpi_health_sample_scheduled_alignment_check' },
  { rule: 'health: measured_at < scheduled_for', table: 'kpi_health_sample', overrides: { scheduled_for: '2026-09-01T12:30:00.000Z', measured_at: '2026-09-01T12:29:59.999Z' }, constraint: 'kpi_health_sample_measured_after_scheduled_check' },

  // ----- kpi_snapshot -----
  { rule: 'snapshot: environment inválido', table: 'kpi_snapshot', overrides: { environment: 'test' }, constraint: 'kpi_snapshot_environment_check' },
  { rule: 'snapshot: snapshot_kind desconocido', table: 'kpi_snapshot', overrides: { snapshot_kind: 'draft' }, constraint: 'kpi_snapshot_snapshot_kind_check' },
  { rule: 'snapshot: kpi_id de negocio (no Telemetry)', table: 'kpi_snapshot', overrides: { kpi_id: 'initial_plans_count' }, constraint: 'kpi_snapshot_kpi_id_check' },
  { rule: 'snapshot: kpi_id desconocido', table: 'kpi_snapshot', overrides: { kpi_id: 'uptime' }, constraint: 'kpi_snapshot_kpi_id_check' },
  { rule: 'snapshot: quality desconocida', table: 'kpi_snapshot', overrides: { quality: 'estimated' }, constraint: 'kpi_snapshot_quality_check' },
  { rule: 'snapshot: sample_count negativo', table: 'kpi_snapshot', overrides: { sample_count: -1 }, constraint: 'kpi_snapshot_sample_count_check' },
  { rule: 'snapshot: window_start = window_end', table: 'kpi_snapshot', overrides: { window_start: '2026-10-09T20:00:00.000Z', window_end: '2026-10-09T20:00:00.000Z' }, constraint: 'kpi_snapshot_window_check' },
  { rule: 'snapshot: window_start > window_end', table: 'kpi_snapshot', overrides: { window_start: '2026-10-09T21:00:00.000Z', window_end: '2026-10-09T20:00:00.000Z' }, constraint: 'kpi_snapshot_window_check' },
  { rule: 'snapshot: observed con value NULL', table: 'kpi_snapshot', overrides: { quality: 'observed', value: null }, constraint: 'kpi_snapshot_observed_value_check' },
  { rule: 'snapshot: observed con value negativo', table: 'kpi_snapshot', overrides: { quality: 'observed', value: -1 }, constraint: 'kpi_snapshot_observed_value_check' },
  { rule: 'snapshot: observed con value Infinity', table: 'kpi_snapshot', overrides: { quality: 'observed', value: 'Infinity' }, constraint: 'kpi_snapshot_observed_value_check' },
  { rule: 'snapshot: observed con value NaN', table: 'kpi_snapshot', overrides: { quality: 'observed', value: 'NaN' }, constraint: 'kpi_snapshot_observed_value_check' },
  { rule: 'snapshot: unavailable con value', table: 'kpi_snapshot', overrides: { quality: 'unavailable', value: 5, reason: 'NO_OPERATIONS' }, constraint: 'kpi_snapshot_unavailable_value_check' },
  { rule: 'snapshot: unavailable sin reason', table: 'kpi_snapshot', overrides: { quality: 'unavailable', value: null, reason: null }, constraint: 'kpi_snapshot_unavailable_value_check' },
  { rule: 'snapshot: unavailable con reason vacío', table: 'kpi_snapshot', overrides: { quality: 'unavailable', value: null, reason: '' }, constraint: 'kpi_snapshot_unavailable_value_check' },
  { rule: 'snapshot: unavailable con reason sólo espacios', table: 'kpi_snapshot', overrides: { quality: 'unavailable', value: null, reason: '   ' }, constraint: 'kpi_snapshot_unavailable_value_check' },
  { rule: 'snapshot: error_rate > 100', table: 'kpi_snapshot', overrides: { kpi_id: 'error_rate', value: 100.5 }, constraint: 'kpi_snapshot_percentage_range_check' },
  { rule: 'snapshot: timeout_rate > 100', table: 'kpi_snapshot', overrides: { kpi_id: 'timeout_rate', value: 101 }, constraint: 'kpi_snapshot_percentage_range_check' },
  { rule: 'snapshot: dependency_error_rate > 100', table: 'kpi_snapshot', overrides: { kpi_id: 'dependency_error_rate', value: 200 }, constraint: 'kpi_snapshot_percentage_range_check' },
  { rule: 'snapshot: availability_rate > 100', table: 'kpi_snapshot', overrides: { kpi_id: 'availability_rate', value: 100.0001 }, constraint: 'kpi_snapshot_percentage_range_check' },
  { rule: 'snapshot: health_status 0.5', table: 'kpi_snapshot', overrides: { kpi_id: 'health_status', value: 0.5 }, constraint: 'kpi_snapshot_health_value_check' },
  { rule: 'snapshot: health_status 2', table: 'kpi_snapshot', overrides: { kpi_id: 'health_status', value: 2 }, constraint: 'kpi_snapshot_health_value_check' },

  // ----- kpi_publication -----
  { rule: 'publication: environment inválido', table: 'kpi_publication', overrides: { environment: 'prd' }, constraint: 'kpi_publication_environment_check' },
  { rule: 'publication: status desconocido', table: 'kpi_publication', overrides: { status: 'pending' }, constraint: 'kpi_publication_status_check' },
  { rule: 'publication: attempt_count 4', table: 'kpi_publication', overrides: { attempt_count: 4 }, constraint: 'kpi_publication_attempt_count_check' },
  { rule: 'publication: attempt_count negativo', table: 'kpi_publication', overrides: { attempt_count: -1 }, constraint: 'kpi_publication_attempt_count_check' },
  { rule: 'publication: window_start = window_end', table: 'kpi_publication', overrides: { window_start: '2026-10-10T00:00:00.000Z' }, constraint: 'kpi_publication_window_check' },
  { rule: 'publication: window_start > window_end', table: 'kpi_publication', overrides: { window_start: '2026-10-10T01:00:00.000Z' }, constraint: 'kpi_publication_window_check' },
  { rule: 'publication: hash en mayúsculas', table: 'kpi_publication', overrides: { status: 'frozen', frozen_batch: BATCH, payload_sha256: 'A'.repeat(64) }, constraint: 'kpi_publication_payload_sha256_format_check' },
  { rule: 'publication: hash de 63 caracteres', table: 'kpi_publication', overrides: { status: 'frozen', frozen_batch: BATCH, payload_sha256: 'a'.repeat(63) }, constraint: 'kpi_publication_payload_sha256_format_check' },
  { rule: 'publication: hash de 65 caracteres', table: 'kpi_publication', overrides: { status: 'frozen', frozen_batch: BATCH, payload_sha256: 'a'.repeat(65) }, constraint: 'kpi_publication_payload_sha256_format_check' },
  { rule: 'publication: hash con carácter no hex', table: 'kpi_publication', overrides: { status: 'frozen', frozen_batch: BATCH, payload_sha256: 'g'.repeat(64) }, constraint: 'kpi_publication_payload_sha256_format_check' },
  { rule: 'publication: lote sin hash', table: 'kpi_publication', overrides: { status: 'preparing', frozen_batch: BATCH, payload_sha256: null }, constraint: 'kpi_publication_batch_hash_pair_check' },
  { rule: 'publication: hash sin lote', table: 'kpi_publication', overrides: { status: 'failed', frozen_batch: null, payload_sha256: HASH }, constraint: 'kpi_publication_batch_hash_pair_check' },
  { rule: 'publication: frozen sin lote ni hash', table: 'kpi_publication', overrides: { status: 'frozen' }, constraint: 'kpi_publication_batch_required_check' },
  { rule: 'publication: accepted sin lote ni hash', table: 'kpi_publication', overrides: { status: 'accepted', accepted_at: '2026-10-10T00:05:00.000Z' }, constraint: 'kpi_publication_batch_required_check' },
  { rule: 'publication: delivered sin lote ni hash', table: 'kpi_publication', overrides: { status: 'delivered', accepted_at: '2026-10-10T00:05:00.000Z', delivered_at: '2026-10-10T00:06:00.000Z' }, constraint: 'kpi_publication_batch_required_check' },
  { rule: 'publication: accepted sin accepted_at', table: 'kpi_publication', overrides: { status: 'accepted', frozen_batch: BATCH, payload_sha256: HASH }, constraint: 'kpi_publication_accepted_at_required_check' },
  { rule: 'publication: delivered sin accepted_at', table: 'kpi_publication', overrides: { status: 'delivered', frozen_batch: BATCH, payload_sha256: HASH, delivered_at: '2026-10-10T00:06:00.000Z' }, constraint: 'kpi_publication_accepted_at_required_check' },
  { rule: 'publication: delivered sin delivered_at', table: 'kpi_publication', overrides: { status: 'delivered', frozen_batch: BATCH, payload_sha256: HASH, accepted_at: '2026-10-10T00:05:00.000Z' }, constraint: 'kpi_publication_delivered_at_required_check' },
];

const VALID_CASES: ValidCase[] = [
  // ----- kpi_http_event -----
  { rule: 'http: pending sin finished/duration/status', table: 'kpi_http_event', overrides: { ...PENDING, http_status: null } },
  { rule: 'http: success 200', table: 'kpi_http_event', overrides: {} },
  { rule: 'http: success 299', table: 'kpi_http_event', overrides: { http_status: 299 } },
  { rule: 'http: client_error 404', table: 'kpi_http_event', overrides: { outcome: 'client_error', http_status: 404 } },
  { rule: 'http: client_error 499', table: 'kpi_http_event', overrides: { outcome: 'client_error', http_status: 499 } },
  { rule: 'http: server_error 500', table: 'kpi_http_event', overrides: { outcome: 'server_error', http_status: 500 } },
  { rule: 'http: server_error 503', table: 'kpi_http_event', overrides: { outcome: 'server_error', http_status: 503 } },
  { rule: 'http: timeout sin http_status', table: 'kpi_http_event', overrides: { outcome: 'timeout', http_status: null } },
  { rule: 'http: timeout 504', table: 'kpi_http_event', overrides: { outcome: 'timeout', http_status: 504 } },
  { rule: 'http: timeout 408', table: 'kpi_http_event', overrides: { outcome: 'timeout', http_status: 408 } },
  { rule: 'http: network_error sin http_status', table: 'kpi_http_event', overrides: { outcome: 'network_error', http_status: null } },
  { rule: 'http: other 302', table: 'kpi_http_event', overrides: { outcome: 'other', http_status: 302 } },
  { rule: 'http: other 100', table: 'kpi_http_event', overrides: { outcome: 'other', http_status: 100 } },
  { rule: 'http: duration 0 y finished_at = started_at', table: 'kpi_http_event', overrides: { finished_at: '2026-10-09T12:00:00.000Z', duration_ms: 0 } },
  { rule: 'http: operation de 200 caracteres', table: 'kpi_http_event', overrides: { operation: 'x'.repeat(200) } },
  { rule: 'http: operation de 1 carácter', table: 'kpi_http_event', overrides: { operation: 'x' } },
  { rule: 'http: environment qa', table: 'kpi_http_event', overrides: { environment: 'qa' } },
  { rule: 'http: environment prod', table: 'kpi_http_event', overrides: { environment: 'prod' } },

  // ----- kpi_dependency_event -----
  { rule: 'dependency: pending', table: 'kpi_dependency_event', overrides: { outcome: 'pending', finished_at: null, duration_ms: null } },
  { rule: 'dependency: success', table: 'kpi_dependency_event', overrides: {} },
  { rule: 'dependency: error', table: 'kpi_dependency_event', overrides: { outcome: 'error', dependency: 'unsplash_search' } },
  { rule: 'dependency: timeout', table: 'kpi_dependency_event', overrides: { outcome: 'timeout', dependency: 'unsplash_download' } },
  { rule: 'dependency: attempt 3', table: 'kpi_dependency_event', overrides: { attempt: 3 } },
  { rule: 'dependency: dependency de 64 caracteres', table: 'kpi_dependency_event', overrides: { dependency: 'd'.repeat(64) } },
  { rule: 'dependency: duration 0', table: 'kpi_dependency_event', overrides: { finished_at: '2026-10-09T12:00:00.000Z', duration_ms: 0 } },

  // ----- kpi_health_sample -----
  { rule: 'health: healthy', table: 'kpi_health_sample', overrides: {} },
  { rule: 'health: unhealthy por API', table: 'kpi_health_sample', overrides: { outcome: 'unhealthy', api_ok: false, database_ok: true, reason: 'API_TIMEOUT' } },
  { rule: 'health: unhealthy por DB', table: 'kpi_health_sample', overrides: { outcome: 'unhealthy', api_ok: true, database_ok: false } },
  { rule: 'health: unhealthy con ambos false', table: 'kpi_health_sample', overrides: { outcome: 'unhealthy', api_ok: false, database_ok: false } },
  { rule: 'health: unhealthy con un false y un NULL', table: 'kpi_health_sample', overrides: { outcome: 'unhealthy', api_ok: false, database_ok: null } },
  { rule: 'health: unknown sin comprobar nada', table: 'kpi_health_sample', overrides: { outcome: 'unknown', api_ok: null, database_ok: null } },
  { rule: 'health: unknown con API ok y DB sin comprobar', table: 'kpi_health_sample', overrides: { outcome: 'unknown', api_ok: true, database_ok: null } },
  { rule: 'health: unknown con API sin comprobar y DB ok', table: 'kpi_health_sample', overrides: { outcome: 'unknown', api_ok: null, database_ok: true } },
  { rule: 'health: measured_at = scheduled_for', table: 'kpi_health_sample', overrides: { scheduled_for: '2026-09-02T00:00:00.000Z', measured_at: '2026-09-02T00:00:00.000Z' } },

  // ----- kpi_snapshot -----
  ...TELEMETRY_KPI_IDS.map(
    (kpiId): ValidCase => ({ rule: `snapshot: kpi_id ${kpiId} observed 1`, table: 'kpi_snapshot', overrides: { kpi_id: kpiId, value: 1 } }),
  ),
  { rule: 'snapshot: operations_count 0', table: 'kpi_snapshot', overrides: { value: 0, sample_count: 0 } },
  { rule: 'snapshot: latency_p95_ms > 100 (no es porcentaje)', table: 'kpi_snapshot', overrides: { kpi_id: 'latency_p95_ms', value: 150000 } },
  { rule: 'snapshot: last_success_age_seconds > 100', table: 'kpi_snapshot', overrides: { kpi_id: 'last_success_age_seconds', value: 86400 } },
  { rule: 'snapshot: error_rate 100', table: 'kpi_snapshot', overrides: { kpi_id: 'error_rate', value: 100 } },
  { rule: 'snapshot: availability_rate 66.666…', table: 'kpi_snapshot', overrides: { kpi_id: 'availability_rate', value: 200 / 3 } },
  { rule: 'snapshot: health_status 0', table: 'kpi_snapshot', overrides: { kpi_id: 'health_status', value: 0 } },
  { rule: 'snapshot: unavailable con reason', table: 'kpi_snapshot', overrides: { kpi_id: 'error_rate', quality: 'unavailable', value: null, reason: 'NO_OPERATIONS', sample_count: 0 } },
  { rule: 'snapshot: final', table: 'kpi_snapshot', overrides: { snapshot_kind: 'final' } },

  // ----- kpi_publication -----
  { rule: 'publication: preparing sin lote', table: 'kpi_publication', overrides: {} },
  { rule: 'publication: frozen con lote y hash', table: 'kpi_publication', overrides: { status: 'frozen', frozen_batch: BATCH, payload_sha256: HASH } },
  { rule: 'publication: accepted con accepted_at', table: 'kpi_publication', overrides: { status: 'accepted', frozen_batch: BATCH, payload_sha256: HASH, accepted_at: '2026-10-10T00:05:00.000Z', attempt_count: 1 } },
  { rule: 'publication: delivered con accepted_at y delivered_at', table: 'kpi_publication', overrides: { status: 'delivered', frozen_batch: BATCH, payload_sha256: '0123456789abcdef'.repeat(4), accepted_at: '2026-10-10T00:05:00.000Z', delivered_at: '2026-10-10T00:06:00.000Z', attempt_count: 3 } },
  { rule: 'publication: failed antes de congelar', table: 'kpi_publication', overrides: { status: 'failed', last_error: 'KPI_PUBLISH_TIMEOUT', attempt_count: 3 } },
  { rule: 'publication: failed después de congelar', table: 'kpi_publication', overrides: { status: 'failed', frozen_batch: BATCH, payload_sha256: HASH, last_error: 'HTTP_503' } },
];

describeIfKpiDb('NUT-85 A2 — CHECK y UNIQUE de las tablas kpi_ sobre Postgres real', () => {
  let db: DisposableSchema;

  async function insert(table: KpiTable, overrides: Row = {}): Promise<Row> {
    const row = { ...ROW_FACTORIES[table](), ...overrides };
    const { sql, params } = buildInsert(table, row);
    await db.client.query(sql, params);
    return row;
  }

  async function insertError(table: KpiTable, overrides: Row = {}) {
    const row = { ...ROW_FACTORIES[table](), ...overrides };
    const { sql, params } = buildInsert(table, row);
    return capturePgError(db.client, sql, params);
  }

  beforeAll(async () => {
    expect(findKpiMigrationDirs()).toHaveLength(1);
    db = await createDisposableSchema();
    await applyMigrations(db.client);
  });

  afterAll(async () => {
    await db?.drop();
  });

  it.each(INVALID_CASES.map(testCase => [testCase.rule, testCase] as const))(
    'rechaza con 23514 — %s',
    async (_rule, testCase) => {
      const error = await insertError(testCase.table, testCase.overrides);
      const accepted = Array.isArray(testCase.constraint) ? testCase.constraint : [testCase.constraint];
      expect(error).not.toBeNull();
      expect(error!.code).toBe('23514');
      expect(accepted).toContain(error!.constraint);
    },
  );

  it.each(VALID_CASES.map(testCase => [testCase.rule, testCase] as const))(
    'acepta la contraparte válida — %s',
    async (_rule, testCase) => {
      await expect(insert(testCase.table, testCase.overrides)).resolves.toBeDefined();
    },
  );

  describe('defaults', () => {
    it('kpi_http_event.recorded_at y kpi_dependency_event.recorded_at tienen default now()', async () => {
      const http = ROW_FACTORIES.kpi_http_event();
      const dep = ROW_FACTORIES.kpi_dependency_event();
      await db.client.query(buildInsert('kpi_http_event', http).sql, buildInsert('kpi_http_event', http).params);
      await db.client.query(buildInsert('kpi_dependency_event', dep).sql, buildInsert('kpi_dependency_event', dep).params);
      const { rows } = await db.client.query<{ http: Date | null; dep: Date | null }>(
        `SELECT (SELECT recorded_at FROM kpi_http_event WHERE id = $1) AS http,
                (SELECT recorded_at FROM kpi_dependency_event WHERE id = $2) AS dep`,
        [http.id, dep.id],
      );
      expect(rows[0].http).toBeInstanceOf(Date);
      expect(rows[0].dep).toBeInstanceOf(Date);
    });

    it('kpi_publication: attempt_count default 0 y created_at/updated_at default now()', async () => {
      const row = ROW_FACTORIES.kpi_publication();
      delete row.attempt_count;
      const { sql, params } = buildInsert('kpi_publication', row);
      await db.client.query(sql, params);
      const { rows } = await db.client.query<{ attempt_count: number; created_at: Date | null; updated_at: Date | null }>(
        'SELECT attempt_count, created_at, updated_at FROM kpi_publication WHERE run_id = $1',
        [row.run_id],
      );
      expect(rows[0].attempt_count).toBe(0);
      expect(rows[0].created_at).toBeInstanceOf(Date);
      expect(rows[0].updated_at).toBeInstanceOf(Date);
    });

    it('los ids no tienen default: un insert sin id falla con NOT NULL (23502)', async () => {
      const row = ROW_FACTORIES.kpi_http_event();
      delete row.id;
      const { sql, params } = buildInsert('kpi_http_event', row);
      const error = await capturePgError(db.client, sql, params);
      expect(error?.code).toBe('23502');
    });
  });

  describe('UNIQUE duplicada ⇒ 23505', () => {
    it('kpi_dependency_event (environment, operation_id, dependency, attempt)', async () => {
      const first = await insert('kpi_dependency_event', { attempt: 1 });
      const duplicate = await insertError('kpi_dependency_event', {
        operation_id: first.operation_id,
        dependency: first.dependency,
        attempt: 1,
      });
      expect(duplicate).toEqual({ code: '23505', constraint: 'kpi_dependency_event_attempt_key' });

      // Otro attempt, otra dependencia u otro ambiente con el mismo operation_id sí se aceptan.
      await expect(insert('kpi_dependency_event', { operation_id: first.operation_id, attempt: 2 })).resolves.toBeDefined();
      await expect(
        insert('kpi_dependency_event', { operation_id: first.operation_id, attempt: 1, dependency: 'unsplash_search' }),
      ).resolves.toBeDefined();
      await expect(
        insert('kpi_dependency_event', { operation_id: first.operation_id, attempt: 1, environment: 'prod' }),
      ).resolves.toBeDefined();
    });

    it('kpi_health_sample (environment, scheduled_for)', async () => {
      const first = await insert('kpi_health_sample');
      const duplicate = await insertError('kpi_health_sample', {
        scheduled_for: first.scheduled_for,
        measured_at: first.measured_at,
        outcome: 'unknown',
        api_ok: null,
        database_ok: null,
      });
      expect(duplicate).toEqual({ code: '23505', constraint: 'kpi_health_sample_bucket_key' });
      await expect(
        insert('kpi_health_sample', { scheduled_for: first.scheduled_for, measured_at: first.measured_at, environment: 'prod' }),
      ).resolves.toBeDefined();
    });

    it('kpi_snapshot (environment, report_date, window_end, snapshot_kind, kpi_id)', async () => {
      const first = await insert('kpi_snapshot', { kpi_id: 'latency_p95_ms', value: 120 });
      const duplicate = await insertError('kpi_snapshot', {
        window_end: first.window_end,
        kpi_id: 'latency_p95_ms',
        value: 130,
      });
      expect(duplicate).toEqual({ code: '23505', constraint: 'kpi_snapshot_cut_key' });
      // Mismo corte con otro kind (preview vs final) u otro kpi_id: se acepta.
      await expect(
        insert('kpi_snapshot', { window_end: first.window_end, kpi_id: 'latency_p95_ms', value: 130, snapshot_kind: 'final' }),
      ).resolves.toBeDefined();
      await expect(insert('kpi_snapshot', { window_end: first.window_end, kpi_id: 'error_rate', value: 5 })).resolves.toBeDefined();
    });

    it('kpi_publication (environment, report_date)', async () => {
      const first = await insert('kpi_publication');
      const duplicate = await insertError('kpi_publication', { report_date: first.report_date });
      expect(duplicate).toEqual({ code: '23505', constraint: 'kpi_publication_day_key' });
      await expect(insert('kpi_publication', { report_date: first.report_date, environment: 'qa' })).resolves.toBeDefined();
    });
  });
});
