import type { KpiEnvironment } from '../../src/modules/kpi/kpi-contract';
import { resolveApprovedSupabaseOrigin } from '../../src/modules/kpi/config/kpi-config';
import { registerKpiCatalog } from '../../src/modules/kpi/kpi-catalog-registration';

async function run(): Promise<void> {
  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const projectKey = process.env.PROJECT_KEY;
  const environment = process.env.KPI_ENV as KpiEnvironment | undefined;
  if (!key || !projectKey || (environment !== 'dev' && environment !== 'prod')) throw new Error('KPI_PUBLISH_CONFIGURATION_INVALID');
  const approvedOrigin = resolveApprovedSupabaseOrigin(environment, baseUrl);
  await registerKpiCatalog({
    environment,
    baseUrl: approvedOrigin,
    approvedOrigin,
    publishableKey: key,
    projectKey,
  });
}

void run().then(() => {
  process.exitCode = 0;
}).catch((error: unknown) => {
  // Keep diagnostics allowlisted: fetch errors can contain URLs or secrets.
  const safeCodes = new Set([
    'CATALOG_CONFLICT',
    'KPI_CATALOG_UNAVAILABLE',
    'KPI_PUBLISH_CONFIGURATION_INVALID',
    'KPI_REMOTE_IDENTITY_INVALID',
    'KPI_REMOTE_IDENTITY_UNAVAILABLE',
  ]);
  const code = error instanceof Error && safeCodes.has(error.message) ? error.message : 'CATALOG_CONFLICT';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
