import type { KpiEnvironment } from './kpi-contract';
import { hasCompleteKpiCatalog, KPI_CATALOG } from './kpi-catalog';
import { SupabaseKpiCatalogClient } from './supabase-kpi-catalog-client';
import { SupabaseKpiRemoteClient } from './supabase-kpi-remote-client';

export interface KpiCatalogRegistrationOptions {
  environment: Extract<KpiEnvironment, 'dev' | 'prod'>;
  baseUrl: string;
  approvedOrigin: string;
  publishableKey: string;
  projectKey: string;
  fetchFn?: typeof fetch;
}

/** Validate project identity, insert only missing definitions, then verify the exact active contract. */
export async function registerKpiCatalog(options: KpiCatalogRegistrationOptions): Promise<void> {
  const clientOptions = { ...options };
  const identity = new SupabaseKpiRemoteClient(clientOptions);
  if (!(await identity.validateIdentity(options.environment))) throw new Error('KPI_REMOTE_IDENTITY_INVALID');

  const client = new SupabaseKpiCatalogClient(clientOptions);
  const existing = validateExisting(await client.list());
  for (const definition of KPI_CATALOG.filter(candidate => !existing.has(candidate.id))) {
    await client.create(definition);
  }

  const reconciled = await client.list();
  const active = reconciled.filter(entry => entry.deprecated_at === null);
  validateExisting(reconciled);
  if (!hasCompleteKpiCatalog(active)) throw new Error('CATALOG_CONFLICT');
}

function validateExisting(entries: readonly Record<string, unknown>[]): Set<string> {
  const expected = new Map<string, (typeof KPI_CATALOG)[number]>(KPI_CATALOG.map(definition => [definition.id, definition]));
  const allIds = new Set<string>();
  const activeIds = new Set<string>();
  for (const entry of entries) {
    if (typeof entry.id !== 'string' || allIds.has(entry.id) ||
      (entry.deprecated_at !== null && typeof entry.deprecated_at !== 'string')) {
      throw new Error('CATALOG_CONFLICT');
    }
    allIds.add(entry.id);
    if (entry.deprecated_at !== null) continue;
    const definition = expected.get(entry.id);
    if (!definition || entry.kind !== definition.kind || entry.unit !== definition.unit) throw new Error('CATALOG_CONFLICT');
    activeIds.add(entry.id);
  }
  for (const definition of KPI_CATALOG) {
    if (allIds.has(definition.id) && !activeIds.has(definition.id)) throw new Error('CATALOG_CONFLICT');
  }
  return allIds;
}
