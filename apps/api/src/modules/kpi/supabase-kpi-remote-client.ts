import type { KpiEnvironment, Measurement } from './kpi-contract';
import { parseRetryAfter } from './kpi-publisher';
import type { KpiRemoteClient, RemotePost, RemoteVerification } from './kpi-publisher';
import { KPI_IDS } from './kpi-catalog';
import { resolveApprovedSupabaseOrigin } from './config/kpi-config';

const PUBLISH_PATH = '/rest/v1/measurement?on_conflict=project_id,kpi_id,date,env';
const VERIFY_PATH = '/rest/v1/measurement';
const DEFAULT_TIMEOUT_MS = 15_000;
export interface SupabaseKpiRemoteClientOptions {
  environment: Extract<KpiEnvironment, 'dev' | 'prod'>;
  baseUrl: string;
  approvedOrigin?: string;
  publishableKey: string;
  projectKey: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class SupabaseKpiIdentityError extends Error {
  readonly kind = 'retryable';

  constructor(
    readonly retryAfterMs: number | null,
    readonly status: number | null,
    readonly errorKind: 'network' | 'timeout' | 'http',
  ) {
    super('KPI_REMOTE_IDENTITY_UNAVAILABLE');
    this.name = 'SupabaseKpiIdentityError';
  }
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
    this.baseUrl = resolveClientOrigin(options.environment, options.baseUrl, options.approvedOrigin);
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async post(payload: Buffer): Promise<RemotePost> {
    const result = await this.request(PUBLISH_PATH, {
      method: 'POST',
      headers: { ...this.headers(), Prefer: 'resolution=ignore-duplicates' },
      body: new Uint8Array(payload),
    }, (response): RemotePost => {
      if (response.ok) return { kind: 'accepted', status: response.status };
      const status = response.status;
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), new Date());
      if (status === 408 || status === 429 || status >= 500) return { kind: 'retryable', status, retryAfterMs };
      return { kind: 'definitive', status };
    });
    return result.kind === 'failure' ? result.outcome : result.value;
  }

  /** Validates the environment-bound project key without retaining its body. */
  async validateIdentity(environment: KpiEnvironment): Promise<boolean> {
    const result = await this.request('/rest/v1/rpc/current_project', {
      method: 'POST', headers: this.headers(), body: '{}',
    }, async (response, signal): Promise<
      | { kind: 'valid' }
      | { kind: 'invalid' }
      | { kind: 'unavailable'; status: number; retryAfterMs: number | null }
    > => {
      if (!response.ok) {
        return isRetryableStatus(response.status)
          ? { kind: 'unavailable', status: response.status, retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), new Date()) }
          : { kind: 'invalid' };
      }
      let body: unknown;
      try {
        // Clone before consuming so a reused fetch Response (for example in
        // an in-process CLI invocation/test harness) remains readable; normal
        // fetch implementations still return an independent Response per call.
        body = await response.clone().json();
      } catch (error) {
        if (signal.aborted || isAbortError(error)) throw error;
        return { kind: 'invalid' };
      }
      const project = Array.isArray(body) && body.length === 1 ? body[0] : null;
      return isRecord(project) && typeof project.env === 'string' && project.env === environment
        ? { kind: 'valid' }
        : { kind: 'invalid' };
    });
    if (result.kind === 'failure') {
      throw new SupabaseKpiIdentityError(null, null, result.outcome.errorKind ?? 'network');
    }
    if (result.value.kind === 'unavailable') {
      throw new SupabaseKpiIdentityError(result.value.retryAfterMs, result.value.status, 'http');
    }
    return result.value.kind === 'valid';
  }

  async verify(environment: KpiEnvironment, date: string, expected: readonly Measurement[]): Promise<RemoteVerification> {
    const scope = `?date=eq.${encodeURIComponent(date)}&env=eq.${encodeURIComponent(environment)}`;
    const result = await this.request(`${VERIFY_PATH}${scope}`, { method: 'GET', headers: this.headers() }, async (response, signal): Promise<RemoteVerification> => {
      if (!response.ok) return {
        kind: 'unavailable', status: response.status, retryable: isRetryableStatus(response.status),
        retryAfterMs: isRetryableStatus(response.status)
          ? parseRetryAfter(response.headers.get('retry-after'), new Date()) : null,
      };
      const status = response.status;
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        if (signal.aborted || isAbortError(error)) throw error;
        return { kind: 'unavailable', status, retryable: false };
      }
      if (!Array.isArray(body)) return { kind: 'unavailable', status, retryable: false };
      if (body.length === 0) return { kind: 'not_found', status };
      if (!body.every(isMeasurementRecord)) return { kind: 'unavailable', status, retryable: false };
      return measurementsMatch(body, expected, date, environment)
        ? { kind: 'match', status }
        : { kind: 'conflict', status };
    });
    return result.kind === 'failure'
      ? { kind: 'unavailable', status: result.outcome.status, retryable: true, errorKind: result.outcome.errorKind ?? 'network' }
      : result.value;
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.options.publishableKey,
      'X-Project-Key': this.options.projectKey,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    read: (response: Response, signal: AbortSignal) => T | Promise<T>,
  ): Promise<{ kind: 'result'; value: T } | { kind: 'failure'; outcome: Extract<RemotePost, { kind: 'retryable' }> }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, { ...init, redirect: 'error', signal: controller.signal });
      return { kind: 'result', value: await read(response, controller.signal) };
    } catch (error) {
      return {
        kind: 'failure',
        outcome: {
          kind: 'retryable', status: null,
          errorKind: isAbortError(error) ? 'timeout' : 'network',
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function measurementsMatch(actual: readonly Record<string, unknown>[], expected: readonly Measurement[], date: string, environment: KpiEnvironment): boolean {
  if (expected.length !== KPI_IDS.length || actual.length !== KPI_IDS.length) return false;
  const expectedIds = new Set(expected.map(value => value.kpi_id));
  const actualIds = new Set(actual.map(value => value.kpi_id));
  if (expectedIds.size !== KPI_IDS.length || actualIds.size !== KPI_IDS.length) return false;
  if (KPI_IDS.some(id => !expectedIds.has(id) || !actualIds.has(id))) return false;
  if (actual.some(value => value.date !== date || value.env !== environment)) return false;
  const actualKeys = new Set(actual.map(measurementKey));
  const expectedKeys = new Set(expected.map(measurementKey));
  return actualKeys.size === actual.length && expectedKeys.size === expected.length &&
    [...expectedKeys].every(key => actualKeys.has(key));
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

function isMeasurementRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.kpi_id === 'string' && typeof value.date === 'string' &&
    typeof value.env === 'string' && typeof value.value === 'number' && Number.isFinite(value.value) &&
    typeof value.run_id === 'string';
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function resolveClientOrigin(
  environment: Extract<KpiEnvironment, 'dev' | 'prod'>,
  baseUrl: string,
  approvedOrigin?: string,
): string {
  const origin = resolveApprovedSupabaseOrigin(environment, approvedOrigin ?? baseUrl);
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('KPI_PUBLISH_CONFIGURATION_INVALID');
  }
  if (url.origin !== origin || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
    throw new Error('KPI_PUBLISH_CONFIGURATION_INVALID');
  }
  return origin;
}
