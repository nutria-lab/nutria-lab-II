import type { KpiEnvironment, Measurement } from './kpi-contract';
import { parseRetryAfter } from './kpi-publisher';
import type { KpiRemoteClient, RemotePost, RemoteVerification } from './kpi-publisher';

const PUBLISH_PATH = '/rest/v1/measurement?on_conflict=project_id,kpi_id,date,env';
const VERIFY_PATH = '/rest/v1/measurement';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface SupabaseKpiRemoteClientOptions {
  baseUrl: string;
  publishableKey: string;
  projectKey: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
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
    return response.kind === 'response' && response.response.ok;
  }

  async verify(environment: KpiEnvironment, date: string, expected: readonly Measurement[]): Promise<RemoteVerification> {
    const response = await this.request(VERIFY_PATH, { method: 'GET', headers: this.headers() });
    if (response.kind === 'failure') return { kind: 'unavailable', status: response.outcome.status };
    if (!response.response.ok) return { kind: 'unavailable', status: response.response.status };

    let body: unknown;
    try {
      body = await response.response.json();
    } catch {
      return { kind: 'unavailable', status: response.response.status };
    }
    if (!Array.isArray(body)) return { kind: 'unavailable', status: response.response.status };

    const sameScope = body.filter((value): value is Record<string, unknown> =>
      isRecord(value) && value.env === environment && value.date === date,
    );
    if (sameScope.length === 0) return { kind: 'not_found', status: response.response.status };
    return measurementsMatch(sameScope, expected)
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

  private async request(path: string, init: RequestInit): Promise<
    { kind: 'response'; response: Response } | { kind: 'failure'; outcome: Extract<RemotePost, { kind: 'retryable' }> }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return { kind: 'response', response: await this.fetchFn(`${this.baseUrl}${path}`, { ...init, signal: controller.signal }) };
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

function measurementsMatch(actual: readonly Record<string, unknown>[], expected: readonly Measurement[]): boolean {
  if (actual.length !== expected.length) return false;
  const actualKeys = new Set(actual.map(measurementKey));
  if (actualKeys.size !== actual.length) return false;
  const expectedKeys = new Set(expected.map(measurementKey));
  return expectedKeys.size === expected.length && [...expectedKeys].every(key => actualKeys.has(key));
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
