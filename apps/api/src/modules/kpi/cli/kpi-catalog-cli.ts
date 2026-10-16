import { parseCatalogCliArgs } from '../kpi-cli';
import { resolveKpiConfig } from '../config/kpi-config';
import { KpiRemoteApiError, SupabaseKpiRemoteClient } from '../supabase-kpi-remote-client';

export async function runKpiCatalogCli(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let targetEnvironment: string | null = null;
  try {
    const args = parseCatalogCliArgs(argv);
    targetEnvironment = args.environment;
    const config = resolveKpiConfig(environment);
    if (config.environment !== args.environment) throw new Error('KPI_ENV_MISMATCH');

    const baseUrl = environment.SUPABASE_URL;
    const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;
    const projectKey = environment.PROJECT_KEY;
    if (!baseUrl || !publishableKey || !projectKey) throw new Error('KPI_CATALOG_CONFIGURATION_INVALID');

    const client = new SupabaseKpiRemoteClient({ baseUrl, publishableKey, projectKey });
    await client.validateIdentity();
    const result = await client.registerCatalog(args.environment);
    console.info(`KPI_CATALOG_RESULT ${JSON.stringify({
      environment: args.environment,
      added_count: result.added_ids.length,
      active_count: result.active_count,
    })}`);
    return 0;
  } catch (error) {
    const code = error instanceof KpiRemoteApiError
      ? error.code
      : error instanceof Error && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message)
        ? error.message
        : 'KPI_CATALOG_FAILED';
    console.error(`KPI_CATALOG_FAILED ${JSON.stringify({
      environment: targetEnvironment,
      error_code: code,
      http_status: error instanceof KpiRemoteApiError ? error.status : null,
      retryable: error instanceof KpiRemoteApiError ? error.retryable : false,
    })}`);
    return 1;
  }
}
