import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Client, Pool, PoolConfig } from 'pg';

export const KPI_TEST_DATABASE_URL_ENV = 'KPI_TEST_DATABASE_URL';

export const PRISMA_DIR = path.resolve(__dirname, '../../../../prisma');
export const MIGRATIONS_DIR = path.resolve(PRISMA_DIR, 'migrations');
export const KPI_PRISMA_FILE = path.resolve(PRISMA_DIR, 'models/kpi.prisma');

// Última migración anterior a la de telemetría KPI.
export const PRE_KPI_BASELINE_MIGRATION = '20260930220304_add_recipe_image';
export const KPI_MIGRATION_NAME_PATTERN = /^\d{14}_add_kpi_telemetry$/;

// Nombres explícitos del esquema KPI: la migración y el map: de Prisma deben usarlos (≤ 63 caracteres, límite de Postgres).

export const KPI_TABLES = [
  'kpi_http_event',
  'kpi_dependency_event',
  'kpi_health_sample',
  'kpi_snapshot',
  'kpi_publication',
] as const;
export type KpiTable = (typeof KPI_TABLES)[number];

export const KPI_PRIMARY_KEYS: Record<KpiTable, { name: string; column: string }> = {
  kpi_http_event: { name: 'kpi_http_event_pkey', column: 'id' },
  kpi_dependency_event: { name: 'kpi_dependency_event_pkey', column: 'id' },
  kpi_health_sample: { name: 'kpi_health_sample_pkey', column: 'id' },
  kpi_snapshot: { name: 'kpi_snapshot_pkey', column: 'id' },
  kpi_publication: { name: 'kpi_publication_pkey', column: 'run_id' },
};

export const KPI_CHECK_CONSTRAINTS: Record<KpiTable, readonly string[]> = {
  kpi_http_event: [
    'kpi_http_event_environment_check',
    'kpi_http_event_outcome_check',
    'kpi_http_event_operation_length_check',
    'kpi_http_event_duration_check',
    'kpi_http_event_http_status_range_check',
    'kpi_http_event_finished_after_started_check',
    'kpi_http_event_lifecycle_check',
    'kpi_http_event_status_by_outcome_check',
  ],
  kpi_dependency_event: [
    'kpi_dependency_event_environment_check',
    'kpi_dependency_event_outcome_check',
    'kpi_dependency_event_dependency_length_check',
    'kpi_dependency_event_attempt_check',
    'kpi_dependency_event_duration_check',
    'kpi_dependency_event_finished_after_started_check',
    'kpi_dependency_event_lifecycle_check',
  ],
  kpi_health_sample: [
    'kpi_health_sample_environment_check',
    'kpi_health_sample_outcome_check',
    'kpi_health_sample_healthy_check',
    'kpi_health_sample_unhealthy_check',
    'kpi_health_sample_unknown_check',
    'kpi_health_sample_scheduled_alignment_check',
    'kpi_health_sample_measured_after_scheduled_check',
  ],
  kpi_snapshot: [
    'kpi_snapshot_environment_check',
    'kpi_snapshot_snapshot_kind_check',
    'kpi_snapshot_kpi_id_check',
    'kpi_snapshot_quality_check',
    'kpi_snapshot_sample_count_check',
    'kpi_snapshot_window_check',
    'kpi_snapshot_observed_value_check',
    'kpi_snapshot_unavailable_value_check',
    'kpi_snapshot_percentage_range_check',
    'kpi_snapshot_health_value_check',
  ],
  kpi_publication: [
    'kpi_publication_environment_check',
    'kpi_publication_status_check',
    'kpi_publication_attempt_count_check',
    'kpi_publication_window_check',
    'kpi_publication_payload_sha256_format_check',
    'kpi_publication_batch_hash_pair_check',
    'kpi_publication_batch_required_check',
    'kpi_publication_accepted_at_required_check',
    'kpi_publication_delivered_at_required_check',
  ],
};

export interface IndexSpec {
  name: string;
  table: string;
  /** Columnas SQL (snake_case para KPI, camelCase para negocio). */
  columns: readonly string[];
  /** Campos Prisma equivalentes (sólo tablas KPI). */
  prismaFields?: readonly string[];
}

export const KPI_UNIQUE_INDEXES: readonly IndexSpec[] = [
  {
    name: 'kpi_dependency_event_attempt_key',
    table: 'kpi_dependency_event',
    columns: ['environment', 'operation_id', 'dependency', 'attempt'],
    prismaFields: ['environment', 'operationId', 'dependency', 'attempt'],
  },
  {
    name: 'kpi_health_sample_bucket_key',
    table: 'kpi_health_sample',
    columns: ['environment', 'scheduled_for'],
    prismaFields: ['environment', 'scheduledFor'],
  },
  {
    name: 'kpi_snapshot_cut_key',
    table: 'kpi_snapshot',
    columns: ['environment', 'report_date', 'window_end', 'snapshot_kind', 'kpi_id'],
    prismaFields: ['environment', 'reportDate', 'windowEnd', 'snapshotKind', 'kpiId'],
  },
  {
    name: 'kpi_publication_day_key',
    table: 'kpi_publication',
    columns: ['environment', 'report_date'],
    prismaFields: ['environment', 'reportDate'],
  },
];

export const KPI_INDEXES: readonly IndexSpec[] = [
  {
    name: 'kpi_http_event_environment_finished_at_idx',
    table: 'kpi_http_event',
    columns: ['environment', 'finished_at'],
    prismaFields: ['environment', 'finishedAt'],
  },
  {
    name: 'kpi_http_event_environment_outcome_finished_at_idx',
    table: 'kpi_http_event',
    columns: ['environment', 'outcome', 'finished_at'],
    prismaFields: ['environment', 'outcome', 'finishedAt'],
  },
  {
    name: 'kpi_http_event_environment_started_at_idx',
    table: 'kpi_http_event',
    columns: ['environment', 'started_at'],
    prismaFields: ['environment', 'startedAt'],
  },
  {
    name: 'kpi_dependency_event_environment_finished_at_idx',
    table: 'kpi_dependency_event',
    columns: ['environment', 'finished_at'],
    prismaFields: ['environment', 'finishedAt'],
  },
  {
    name: 'kpi_dependency_event_environment_outcome_finished_at_idx',
    table: 'kpi_dependency_event',
    columns: ['environment', 'outcome', 'finished_at'],
    prismaFields: ['environment', 'outcome', 'finishedAt'],
  },
  {
    name: 'kpi_health_sample_environment_measured_at_idx',
    table: 'kpi_health_sample',
    columns: ['environment', 'measured_at'],
    prismaFields: ['environment', 'measuredAt'],
  },
  {
    name: 'kpi_snapshot_environment_report_date_snapshot_kind_idx',
    table: 'kpi_snapshot',
    columns: ['environment', 'report_date', 'snapshot_kind'],
    prismaFields: ['environment', 'reportDate', 'snapshotKind'],
  },
  {
    name: 'kpi_publication_status_updated_at_idx',
    table: 'kpi_publication',
    columns: ['status', 'updated_at'],
    prismaFields: ['status', 'updatedAt'],
  },
];

export const BUSINESS_CREATED_AT_INDEXES: readonly IndexSpec[] = [
  { name: 'meal_plans_createdAt_idx', table: 'meal_plans', columns: ['createdAt'] },
  { name: 'recipes_createdAt_idx', table: 'recipes', columns: ['createdAt'] },
];

/** Los 8 KPI de Telemetry (subconjunto de KpiId del contrato de Lara). */
export const TELEMETRY_KPI_IDS = [
  'availability_rate',
  'dependency_error_rate',
  'error_rate',
  'health_status',
  'last_success_age_seconds',
  'latency_p95_ms',
  'operations_count',
  'timeout_rate',
] as const;

// ---------------------------------------------------------------------------
// Variable de entorno y guarda de host
// ---------------------------------------------------------------------------

export function kpiTestDatabaseUrl(): string | undefined {
  const value = process.env[KPI_TEST_DATABASE_URL_ENV];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Lanza si la URL no apunta a un Postgres local. Nunca incluye la URL (ni credenciales) en el mensaje. */
export function assertLocalHost(url: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(`${KPI_TEST_DATABASE_URL_ENV} no es una URL válida de Postgres.`);
  }
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `${KPI_TEST_DATABASE_URL_ENV} debe apuntar a localhost, 127.0.0.1 o ::1 ` +
        '(Postgres desechable). Se rechaza cualquier otro host para no tocar bases compartidas.',
    );
  }
}

/**
 * `describe` si hay KPI_TEST_DATABASE_URL (con guarda de host que hace fallar la suite),
 * `describe.skip` si no.
 */
export function describeIfKpiDb(name: string, fn: () => void): void {
  const url = kpiTestDatabaseUrl();
  if (!url) {
    describe.skip(`${name} [skip: falta ${KPI_TEST_DATABASE_URL_ENV}]`, fn);
    return;
  }
  describe(name, () => {
    beforeAll(() => {
      assertLocalHost(url);
    });
    fn();
  });
}

// ---------------------------------------------------------------------------
// Migraciones
// ---------------------------------------------------------------------------

/** Carpetas de migración en orden lexicográfico (= cronológico por el prefijo YYYYMMDDHHMMSS). */
export function listMigrationDirs(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => fs.existsSync(path.join(MIGRATIONS_DIR, name, 'migration.sql')))
    .sort();
}

export function findKpiMigrationDirs(): string[] {
  return listMigrationDirs().filter(
    name => KPI_MIGRATION_NAME_PATTERN.test(name) && name > PRE_KPI_BASELINE_MIGRATION,
  );
}

export function readMigrationSql(dirName: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, dirName, 'migration.sql'), 'utf-8');
}

export interface ApplyMigrationsOptions {
  /** Aplica hasta esta carpeta inclusive. */
  upTo?: string;
  /** Aplica sólo las carpetas estrictamente posteriores a ésta. */
  after?: string;
}

/** Aplica migration.sql en orden, cada uno en su transacción (como Prisma). Devuelve los nombres aplicados. */
export async function applyMigrations(client: Client, options: ApplyMigrationsOptions = {}): Promise<string[]> {
  const dirs = listMigrationDirs().filter(
    name =>
      (options.upTo === undefined || name <= options.upTo) && (options.after === undefined || name > options.after),
  );
  for (const dir of dirs) {
    const sql = readMigrationSql(dir);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      const code = (error as { code?: string }).code ?? 'unknown';
      throw new Error(`Falló la migración ${dir} (SQLSTATE ${code}): ${(error as Error).message}`);
    }
  }
  return dirs;
}

// ---------------------------------------------------------------------------
// Schema descartable
// ---------------------------------------------------------------------------

export interface DisposableSchema {
  schema: string;
  client: Client;
  /** Config para crear un Pool que use el mismo search_path. */
  poolConfig(extra?: PoolConfig): PoolConfig;
  createPool(extra?: PoolConfig): Pool;
  drop(): Promise<void>;
}

function isDuplicateObject(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === '42710' || code === '23505';
}

export async function createDisposableSchema(): Promise<DisposableSchema> {
  const url = kpiTestDatabaseUrl();
  if (!url) {
    throw new Error(`Falta ${KPI_TEST_DATABASE_URL_ENV}.`);
  }
  assertLocalHost(url);

  const schema = `kpi_it_${randomBytes(6).toString('hex')}`;
  const searchPath = `${schema},public`;

  const admin = new Client({ connectionString: url });
  await admin.connect();
  try {
    // unaccent queda en public: si quedara en el schema descartable, el DROP ... CASCADE lo
    // borraría y suites paralelas chocarían. La migración enable_unaccent pasa a ser no-op.
    try {
      await admin.query('CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public');
    } catch (error) {
      if (!isDuplicateObject(error)) throw error;
    }
    await admin.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await admin.end();
  }

  const options = `-c search_path=${searchPath}`;
  const client = new Client({ connectionString: url, options });
  await client.connect();

  const pools: Pool[] = [];

  return {
    schema,
    client,
    poolConfig: (extra: PoolConfig = {}) => ({ connectionString: url, options, ...extra }),
    createPool: (extra: PoolConfig = {}) => {
      const pool = new Pool({ connectionString: url, options, ...extra });
      pools.push(pool);
      return pool;
    },
    drop: async () => {
      await Promise.all(pools.map(pool => pool.end().catch(() => undefined)));
      await client.end().catch(() => undefined);
      const cleanup = new Client({ connectionString: url });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

/** Error de Postgres con SQLSTATE y constraint (lo que expone `pg`). */
export interface PgError {
  code?: string;
  constraint?: string;
}

/** Ejecuta la query y devuelve el error de Postgres, o null si no falló. */
export async function capturePgError(client: Client, sql: string, params: unknown[] = []): Promise<PgError | null> {
  try {
    await client.query(sql, params);
    return null;
  } catch (error) {
    const { code, constraint } = error as PgError;
    return { code, constraint };
  }
}
