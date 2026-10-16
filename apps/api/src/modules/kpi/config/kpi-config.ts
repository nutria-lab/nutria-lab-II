// Recibe el entorno por parámetro: nunca lee process.env ni infiere el ambiente de NODE_ENV.
import type { KpiEnvironment } from '../kpi-contract';

export type KpiDisabledReason = 'KPI_ENV_MISSING' | 'KPI_ENV_INVALID' | 'KPI_SWITCH_OFF' | 'KPI_SWITCH_INVALID';

export interface KpiConfig {
  enabled: boolean;
  environment: KpiEnvironment | null;
  disabledReason: KpiDisabledReason | null;
}

export type KpiEnvSource = Readonly<Record<string, string | undefined>>;

const VALID_ENVIRONMENTS: readonly string[] = ['dev', 'qa', 'prod'];

const APPROVED_SUPABASE_ORIGINS: Readonly<Record<'dev' | 'prod', string>> = {
  dev: 'https://gapkrqfdshqbowdtldzc.supabase.co',
  prod: 'https://rzlalzowistpiphmdqpp.supabase.co',
};

/** Resolve only the Linear-approved Supabase project origin for a publisher environment. */
export function resolveApprovedSupabaseOrigin(environment: 'dev' | 'prod', value: string | undefined): string {
  if (!value) throw new Error('KPI_PUBLISH_CONFIGURATION_INVALID');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('KPI_PUBLISH_CONFIGURATION_INVALID');
  }
  const approvedOrigin = APPROVED_SUPABASE_ORIGINS[environment];
  if (parsed.protocol !== 'https:' || parsed.origin !== approvedOrigin || parsed.pathname !== '/' ||
    parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error('KPI_PUBLISH_CONFIGURATION_INVALID');
  }
  return approvedOrigin;
}

export function resolveKpiConfig(env: KpiEnvSource): KpiConfig {
  const rawEnvironment = env.KPI_ENV;
  if (rawEnvironment === undefined || rawEnvironment === '') {
    return { enabled: false, environment: null, disabledReason: 'KPI_ENV_MISSING' };
  }
  if (!VALID_ENVIRONMENTS.includes(rawEnvironment)) {
    return { enabled: false, environment: null, disabledReason: 'KPI_ENV_INVALID' };
  }
  const environment = rawEnvironment as KpiEnvironment;

  const rawSwitch = env.KPI_INSTRUMENTATION_ENABLED;
  if (rawSwitch === 'false') {
    return { enabled: false, environment, disabledReason: 'KPI_SWITCH_OFF' };
  }
  if (rawSwitch !== undefined && rawSwitch !== 'true') {
    return { enabled: false, environment, disabledReason: 'KPI_SWITCH_INVALID' };
  }
  return { enabled: true, environment, disabledReason: null };
}
