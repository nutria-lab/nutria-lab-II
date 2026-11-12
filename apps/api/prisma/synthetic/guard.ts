// NUT-114 — Guard del destino del seed. Puro: no importa pg ni Prisma y nunca lee process.env
// (el entorno llega inyectado). Los mensajes de error nunca incluyen credenciales ni URLs.

export type SeedEnv = Record<string, string | undefined>;

export type SeedGuardErrorCode =
  | 'missing_database_url'
  | 'invalid_database_url'
  | 'production_env'
  | 'target_not_allowed'
  | 'confirm_target_mismatch'
  | 'missing_demo_password';

export class SeedGuardError extends Error {
  readonly code: SeedGuardErrorCode;

  constructor(code: SeedGuardErrorCode, message: string) {
    super(message);
    this.name = 'SeedGuardError';
    this.code = code;
  }
}

export interface SeedTarget {
  target: string;
  maskedHost: string;
  database: string;
  synthetic: boolean;
}

const URL_KEYS = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'DIRECT_URL'] as const;
const PRODUCTION_KEYS = ['NODE_ENV', 'KPI_ENV', 'VERCEL_ENV'] as const;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

interface ParsedTarget {
  host: string;
  database: string;
}

function normalizeHost(host: string): string {
  const lower = host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  // Neon expone el mismo endpoint como "ep-x-123-pooler.<región>" y "ep-x-123.<región>".
  return lower.replace(/^([^.]+)-pooler(?=\.|$)/, '$1');
}

function parseTarget(url: string, label: string): ParsedTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SeedGuardError('invalid_database_url', `${label} no es una URL de base de datos válida.`);
  }
  const host = normalizeHost(parsed.hostname);
  let database: string;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  } catch {
    database = '';
  }
  if (!host || !database || database.includes('/')) {
    throw new SeedGuardError('invalid_database_url', `${label} no es una URL de base de datos válida.`);
  }
  return { host, database };
}

function parseAllowedEntry(entry: string): string | null {
  const trimmed = entry.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  return `${normalizeHost(trimmed.slice(0, slash))}/${trimmed.slice(slash + 1).trim()}`;
}

function maskHost(host: string): string {
  if (LOCAL_HOSTS.has(host)) return host;
  const labels = host.split('.');
  const first = labels[0];
  const parts = first.split('-');
  const maskedFirst = parts.length >= 2 ? `${parts[0]}-***-${parts[parts.length - 1]}` : `${first.slice(0, 1)}***`;
  const suffix = labels.length >= 3 ? labels.slice(-2).join('.') : labels.slice(1).join('.');
  return suffix ? `${maskedFirst}…${suffix}` : maskedFirst;
}

/** "postgresql://u:p@ep-x-123-pooler.region.aws.neon.tech:5432/neondb" -> "ep-x-123.region.aws.neon.tech/neondb". */
export function normalizeSeedTarget(url: string): string {
  const { host, database } = parseTarget(url, 'La URL');
  return `${host}/${database}`;
}

export function assertSeedTarget(env: SeedEnv): SeedTarget {
  for (const key of PRODUCTION_KEYS) {
    if (env[key] === 'production') {
      throw new SeedGuardError('production_env', `El seed no corre con ${key}=production.`);
    }
  }

  if (!env.DATABASE_URL) {
    throw new SeedGuardError('missing_database_url', 'DATABASE_URL no está definida.');
  }

  const allowed = new Set(
    (env.SEED_ALLOWED_TARGETS ?? '')
      .split(',')
      .map(parseAllowedEntry)
      .filter((entry): entry is string => entry !== null),
  );

  let primary: ParsedTarget | null = null;
  for (const key of URL_KEYS) {
    const value = env[key];
    if (!value) continue;
    const parsed = parseTarget(value, key);
    if (key === 'DATABASE_URL') primary = parsed;
    const target = `${parsed.host}/${parsed.database}`;
    if (!LOCAL_HOSTS.has(parsed.host) && !allowed.has(target)) {
      throw new SeedGuardError(
        'target_not_allowed',
        `${key} apunta a ${maskHost(parsed.host)}/${parsed.database}, que no está en SEED_ALLOWED_TARGETS.`,
      );
    }
  }

  const { host, database } = primary as ParsedTarget;
  const target = `${host}/${database}`;
  const maskedHost = maskHost(host);
  const synthetic = env.SEED_SYNTHETIC === 'true';

  if (synthetic) {
    const confirm = env.SEED_CONFIRM_TARGET ? parseAllowedEntry(env.SEED_CONFIRM_TARGET) : null;
    if (confirm !== target) {
      throw new SeedGuardError(
        'confirm_target_mismatch',
        `SEED_CONFIRM_TARGET debe coincidir con el destino ${maskedHost}/${database}.`,
      );
    }
    if (!env.SEED_DEMO_PASSWORD) {
      throw new SeedGuardError('missing_demo_password', 'SEED_DEMO_PASSWORD es obligatoria con SEED_SYNTHETIC=true.');
    }
  }

  return { target, maskedHost, database, synthetic };
}

export async function withSeedGuard<C, R>(
  env: SeedEnv,
  createClient: () => C,
  run: (client: C, target: SeedTarget) => Promise<R>,
): Promise<R> {
  const target = assertSeedTarget(env);
  const client = createClient();
  return run(client, target);
}
