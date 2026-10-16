import type { KpiCatalogDefinition } from './kpi-catalog';
import type { KpiEnvironment } from './kpi-contract';
import { resolveClientOrigin } from './supabase-kpi-remote-client';

const DEFAULT_TIMEOUT_MS = 15_000;
const CATALOG_PATH = '/rest/v1/kpi_catalog';
const CATALOG_SELECT = 'id,kind,unit,deprecated_at';

export interface SupabaseKpiCatalogClientOptions {
  environment: Extract<KpiEnvironment, 'dev' | 'prod'>;
  baseUrl: string;
  approvedOrigin: string;
  publishableKey: string;
  projectKey: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/** Small authenticated adapter for the explicitly-invoked catalog registration CLI. */
export class SupabaseKpiCatalogClient {
  private readonly origin: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: SupabaseKpiCatalogClientOptions) {
    this.origin = resolveClientOrigin(options.environment, options.baseUrl, options.approvedOrigin);
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async list(): Promise<Record<string, unknown>[]> {
    const url = `${CATALOG_PATH}?select=${encodeURIComponent(CATALOG_SELECT)}`;
    return this.request(url, { method: 'GET' }, async response => {
      if (!response.ok) throw catalogResponseError(response.status);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error('CATALOG_CONFLICT');
      }
      if (!Array.isArray(body) || !body.every(isRecord)) throw new Error('CATALOG_CONFLICT');
      return body;
    });
  }

  async create(definition: KpiCatalogDefinition): Promise<void> {
    await this.request(CATALOG_PATH, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(definition),
    }, response => {
      if (!response.ok) throw catalogResponseError(response.status);
      return undefined;
    });
  }

  private async request<T>(path: string, init: RequestInit, read: (response: Response) => T | Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(`${this.origin}${path}`, {
        ...init,
        headers: {
          apikey: this.options.publishableKey,
          'X-Project-Key': this.options.projectKey,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        redirect: 'error',
        signal: controller.signal,
      });
      return await read(response);
    } catch (error) {
      // Never propagate fetch/response details; they can contain URLs or credentials.
      if (error instanceof Error && (error.message === 'CATALOG_CONFLICT' || error.message === 'KPI_CATALOG_UNAVAILABLE')) {
        throw error;
      }
      throw new Error('KPI_CATALOG_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }
}

function catalogResponseError(status: number): Error {
  return new Error(status === 408 || status === 429 || status >= 500 ? 'KPI_CATALOG_UNAVAILABLE' : 'CATALOG_CONFLICT');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
