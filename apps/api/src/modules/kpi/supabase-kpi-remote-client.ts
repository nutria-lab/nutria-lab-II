import { ALL_KPI_IDS, LEGACY_KPI_IDS } from './kpi-contract';
import type { KpiEnvironment, Measurement } from './kpi-contract';
import { KPI_CATALOG_DEFINITIONS, validateKpiCatalogDefinitions } from './kpi-catalog-definitions';
import type { KpiCatalogDefinition } from './kpi-catalog-definitions';
import { parseRetryAfter, StructuralKpiError } from './kpi-publisher';
import type { KpiRemoteClient, RemotePost, RemoteVerification } from './kpi-publisher';

const PUBLISH_PATH = '/rest/v1/measurement?on_conflict=project_id,kpi_id,date,env';
const VERIFY_PATH = '/rest/v1/measurement';
const DEFAULT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT = Symbol('REQUEST_TIMEOUT');
const KPI_IDS = ALL_KPI_IDS;

type RemoteResponse = { kind: 'response'; response: Response; body?: unknown; bodyValid?: boolean };
type RemoteRequestFailure = { kind: 'failure'; outcome: Extract<RemotePost, { kind: 'retryable' }> };
type RemoteRequestResult = RemoteResponse | RemoteRequestFailure;

export interface SupabaseKpiRemoteClientOptions {
  baseUrl: string;
  publishableKey: string;
  projectKey: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class KpiRemoteApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(code);
    this.name = 'KpiRemoteApiError';
  }
}

export interface KpiCatalogSyncResult {
  added_ids: readonly string[];
  active_count: number;
}

/**
 * Minimal adapter for the public KPI Supabase contract.  It deliberately
 * neither logs HTTP failures nor exposes response text: both may contain data
 * that must not become a workflow artifact.
 */
export class SupabaseKpiRemoteClient implements KpiRemoteClient {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(private readonly options: SupabaseKpiRemoteClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async post(payload: Buffer): Promise<RemotePost> {
    assertMeasurementPayload(payload);
    const response = await this.request(PUBLISH_PATH, {
      method: 'POST',
      headers: { ...this.headers(), Prefer: 'resolution=ignore-duplicates' },
      body: new Uint8Array(payload),
    });
    if (response.kind === 'failure') return response.outcome;
    if (response.response.ok) return { kind: 'accepted', status: response.response.status };

    const status = response.response.status;
    const retryAfterMs = parseRetryAfter(response.response.headers.get('retry-after'), new Date());
    if (status === 408 || status === 429 || status >= 500) return { kind: 'retryable', status, retryAfterMs };
    return { kind: 'definitive', status };
  }

  /** Validates the environment-bound project key without retaining its body. */
  async validateIdentity(): Promise<boolean> {
    const response = await this.request('/rest/v1/rpc/current_project', {
      method: 'POST', headers: this.headers(), body: '{}',
    });
    if (response.kind === 'failure') {
      throw new KpiRemoteApiError('KPI_REMOTE_IDENTITY_UNAVAILABLE', null, true);
    }
    if (!response.response.ok) throw httpApiError('KPI_REMOTE_IDENTITY_INVALID', response.response);
    return true;
  }

  /** Manual, idempotent catalog setup. Publication/retry paths never call this. */
  async registerCatalog(environment: KpiEnvironment, definitions: readonly KpiCatalogDefinition[] = KPI_CATALOG_DEFINITIONS): Promise<KpiCatalogSyncResult> {
    validateKpiCatalogDefinitions(definitions);
    const first = await this.readCatalog(environment);
    const firstCheck = validateActiveCatalog(first, definitions);
    const missing = definitions.filter(definition => !firstCheck.activeById.has(definition.id));
    if (firstCheck.activeById.size + missing.length > KPI_IDS.length) throw catalogConflict('KPI_CATALOG_ACTIVE_LIMIT');

    if (missing.length > 0) {
      const response = await this.request('/rest/v1/kpi_catalog', {
        method: 'POST',
        headers: { ...this.headers(), Prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify(missing),
      });
      if (response.kind === 'failure') throw new KpiRemoteApiError('KPI_CATALOG_UNAVAILABLE', null, true);
      if (!response.response.ok) throw httpApiError('KPI_CATALOG_HTTP_ERROR', response.response);
    }

    const verified = await this.readCatalog(environment);
    const verifiedCheck = validateActiveCatalog(verified, definitions);
    if (verifiedCheck.activeById.size !== definitions.length) throw catalogConflict('KPI_CATALOG_INCOMPLETE');
    return { added_ids: missing.map(definition => definition.id), active_count: verifiedCheck.activeById.size };
  }

  private async readCatalog(environment: KpiEnvironment): Promise<readonly Record<string, unknown>[]> {
    const result = await this.request('/rest/v1/kpi_catalog?select=*', { method: 'GET', headers: this.headers() }, true);
    if (result.kind === 'failure') throw new KpiRemoteApiError('KPI_CATALOG_UNAVAILABLE', null, true);
    if (!result.response.ok) throw httpApiError('KPI_CATALOG_HTTP_ERROR', result.response);
    if (!result.bodyValid || !Array.isArray(result.body) || !result.body.every(isRecord)) {
      throw catalogConflict('KPI_CATALOG_RESPONSE_INVALID');
    }
    return result.body.filter(row => rowEnvironment(row) === null || rowEnvironment(row) === environment);
  }

  async verify(environment: KpiEnvironment, date: string, expected: readonly Measurement[]): Promise<RemoteVerification> {
    if (!hasSupportedSet(expected.map(({ kpi_id }) => kpi_id))) throw new StructuralKpiError('KPI_REMOTE_EXPECTED_SET_INVALID');
    const query = new URLSearchParams({
      select: 'kpi_id,date,env,value,run_id',
      date: `eq.${date}`,
      env: `eq.${environment}`,
    });
    const response = await this.request(`${VERIFY_PATH}?${query.toString()}`, { method: 'GET', headers: this.headers() }, true);
    if (response.kind === 'failure') return { kind: 'unavailable', status: response.outcome.status };
    if (!response.response.ok) return { kind: 'unavailable', status: response.response.status };
    if (!response.bodyValid || !Array.isArray(response.body)) return { kind: 'unavailable', status: response.response.status };
    const rows = response.body.filter(isRecord);
    if (rows.length !== response.body.length) return { kind: 'unavailable', status: response.response.status };
    if (rows.length === 0) return { kind: 'not_found', status: response.response.status };
    return measurementsMatch(rows, expected)
      ? { kind: 'match', status: response.response.status }
      : { kind: 'conflict', status: response.response.status };
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.options.publishableKey,
      'X-Project-Key': this.options.projectKey,
      'Content-Type': 'application/json',
    };
  }

  private async request(path: string, init: RequestInit, parseJson = false): Promise<RemoteRequestResult> {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(REQUEST_TIMEOUT);
      }, this.timeoutMs);
    });
    try {
      const response = await Promise.race([
        this.fetchFn(`${this.baseUrl}${path}`, { ...init, signal: controller.signal }),
        timeout,
      ]);
      if (!parseJson) return { kind: 'response', response };
      try {
        const body = await Promise.race([response.json(), timeout]);
        return { kind: 'response', response, body, bodyValid: true };
      } catch (error) {
        if (timedOut || error === REQUEST_TIMEOUT) {
          return { kind: 'failure', outcome: { kind: 'retryable', status: null, errorKind: 'timeout' } };
        }
        return { kind: 'response', response, body: null, bodyValid: false };
      }
    } catch (error) {
      return {
        kind: 'failure',
        outcome: {
          kind: 'retryable', status: null,
          errorKind: timedOut || error === REQUEST_TIMEOUT || isAbortError(error) ? 'timeout' : 'network',
        },
      };
    } finally {
      clearTimeout(timer!);
    }
  }
}

function validateActiveCatalog(
  rows: readonly Record<string, unknown>[],
  definitions: readonly KpiCatalogDefinition[],
): { activeById: Map<string, Record<string, unknown>> } {
  const expected = new Map<string, KpiCatalogDefinition>(definitions.map(definition => [definition.id, definition]));
  const activeById = new Map<string, Record<string, unknown>>();
  const inactiveExpected = new Set<string>();
  for (const row of rows) {
    const id = row.id;
    if (typeof id !== 'string') throw catalogConflict('KPI_CATALOG_RESPONSE_INVALID');
    const active = catalogRowIsActive(row);
    if (!active) {
      if (expected.has(id)) inactiveExpected.add(id);
      continue;
    }
    if (!expected.has(id) || activeById.has(id)) throw catalogConflict('KPI_CATALOG_ACTIVE_SET_CONFLICT');
    const definition = expected.get(id)!;
    if (row.kind !== definition.kind || row.unit !== definition.unit) throw catalogConflict('KPI_CATALOG_DEFINITION_CONFLICT');
    activeById.set(id, row);
  }
  if (inactiveExpected.size > 0) throw catalogConflict('KPI_CATALOG_INACTIVE_DEFINITION');
  if (activeById.size > KPI_IDS.length) throw catalogConflict('KPI_CATALOG_ACTIVE_LIMIT');
  return { activeById };
}

function catalogRowIsActive(row: Record<string, unknown>): boolean {
  if (typeof row.is_active === 'boolean') return row.is_active;
  if (typeof row.active === 'boolean') return row.active;
  if (typeof row.status === 'string') return row.status === 'active';
  // Some API versions expose only the active view; absence is treated fail-closed
  // for unexpected rows by validating an exact supported ID set above.
  return true;
}

function rowEnvironment(row: Record<string, unknown>): string | null {
  const value = row.env ?? row.environment;
  return typeof value === 'string' ? value : null;
}

function httpApiError(code: string, response: Response): KpiRemoteApiError {
  const status = response.status;
  const retryable = status === 408 || status === 429 || status >= 500;
  const retryAfterMs = retryable ? parseRetryAfter(response.headers.get('retry-after'), new Date()) : null;
  return new KpiRemoteApiError(code, status, retryable, retryAfterMs);
}

function catalogConflict(code: string): KpiRemoteApiError {
  return new KpiRemoteApiError(code, null, false);
}

function measurementsMatch(actual: readonly Record<string, unknown>[], expected: readonly Measurement[]): boolean {
  if (actual.length !== expected.length) return false;
  const actualKeys = new Set(actual.map(measurementKey));
  if (actualKeys.size !== actual.length) return false;
  const expectedKeys = new Set(expected.map(measurementKey));
  return expectedKeys.size === expected.length && [...expectedKeys].every(key => actualKeys.has(key));
}

function assertMeasurementPayload(payload: Buffer): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString('utf8')) as unknown;
  } catch {
    throw new StructuralKpiError('KPI_MEASUREMENT_PAYLOAD_INVALID');
  }
  if (!Array.isArray(parsed) ||
    !parsed.every(isMeasurementRecord)) {
    throw new StructuralKpiError('KPI_MEASUREMENT_SET_INVALID');
  }
  const measurements = parsed as Measurement[];
  const ids = measurements.map(item => item.kpi_id);
  if (!hasSupportedSet(ids) ||
    measurements.some(item => item.date !== measurements[0].date || item.env !== measurements[0].env || item.run_id !== measurements[0].run_id)) {
    throw new StructuralKpiError('KPI_MEASUREMENT_SET_INVALID');
  }
  if (!Buffer.from(JSON.stringify(measurements), 'utf8').equals(payload)) {
    throw new StructuralKpiError('KPI_MEASUREMENT_PAYLOAD_NOT_CANONICAL');
  }
}

function isMeasurementRecord(value: unknown): value is Measurement {
  if (!isRecord(value) || Object.keys(value).join(',') !== 'kpi_id,date,env,value,run_id') return false;
  return typeof value.kpi_id === 'string' && (KPI_IDS as readonly string[]).includes(value.kpi_id) &&
    typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
    (value.env === 'dev' || value.env === 'qa' || value.env === 'prod') &&
    typeof value.value === 'number' && Number.isFinite(value.value) &&
    typeof value.run_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.run_id);
}

function measurementKey(value: Pick<Measurement, 'kpi_id' | 'date' | 'env' | 'value' | 'run_id'> | Record<string, unknown>): string {
  return JSON.stringify([
    value.kpi_id,
    value.date,
    value.env,
    value.value,
    value.run_id,
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
}

function hasSupportedSet(ids: readonly string[]): boolean {
  if (new Set(ids).size !== ids.length) return false;
  const actual = new Set(ids);
  return hasExactSet(actual, KPI_IDS) || hasExactSet(actual, LEGACY_KPI_IDS);
}

function hasExactSet(actual: ReadonlySet<string>, expected: readonly string[]): boolean {
  return actual.size === expected.length && expected.every(id => actual.has(id));
}
