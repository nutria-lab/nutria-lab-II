import {
  BUSINESS_CREATED_AT_INDEXES,
  DisposableSchema,
  KPI_CHECK_CONSTRAINTS,
  KPI_INDEXES,
  KPI_PRIMARY_KEYS,
  KPI_TABLES,
  KPI_UNIQUE_INDEXES,
  PRE_KPI_BASELINE_MIGRATION,
  applyMigrations,
  assertLocalHost,
  createDisposableSchema,
  describeIfKpiDb,
  findKpiMigrationDirs,
} from './kpi-test-db.fixture';

jest.setTimeout(60_000);

interface ColumnSpec {
  type: string;
  nullable: boolean;
  /** Precisión de timestamptz. */
  precision?: number;
  hasDefault?: boolean;
}

const TSTZ3 = (nullable: boolean, hasDefault = false): ColumnSpec => ({
  type: 'timestamp with time zone',
  nullable,
  precision: 3,
  hasDefault,
});

const EXPECTED_COLUMNS: Record<string, Record<string, ColumnSpec>> = {
  kpi_http_event: {
    id: { type: 'uuid', nullable: false },
    environment: { type: 'text', nullable: false },
    operation: { type: 'text', nullable: false },
    started_at: TSTZ3(false),
    finished_at: TSTZ3(true),
    duration_ms: { type: 'double precision', nullable: true },
    http_status: { type: 'smallint', nullable: true },
    outcome: { type: 'text', nullable: false },
    recorded_at: TSTZ3(false, true),
  },
  kpi_dependency_event: {
    id: { type: 'uuid', nullable: false },
    environment: { type: 'text', nullable: false },
    operation_id: { type: 'uuid', nullable: false },
    dependency: { type: 'text', nullable: false },
    attempt: { type: 'integer', nullable: false },
    started_at: TSTZ3(false),
    finished_at: TSTZ3(true),
    duration_ms: { type: 'double precision', nullable: true },
    outcome: { type: 'text', nullable: false },
    recorded_at: TSTZ3(false, true),
  },
  kpi_health_sample: {
    id: { type: 'uuid', nullable: false },
    environment: { type: 'text', nullable: false },
    scheduled_for: TSTZ3(false),
    measured_at: TSTZ3(false),
    api_ok: { type: 'boolean', nullable: true },
    database_ok: { type: 'boolean', nullable: true },
    outcome: { type: 'text', nullable: false },
    reason: { type: 'text', nullable: true },
  },
  kpi_snapshot: {
    id: { type: 'uuid', nullable: false },
    environment: { type: 'text', nullable: false },
    report_date: { type: 'date', nullable: false },
    window_start: TSTZ3(false),
    window_end: TSTZ3(false),
    snapshot_kind: { type: 'text', nullable: false },
    kpi_id: { type: 'text', nullable: false },
    value: { type: 'double precision', nullable: true },
    quality: { type: 'text', nullable: false },
    reason: { type: 'text', nullable: true },
    sample_count: { type: 'bigint', nullable: false },
    measured_at: TSTZ3(false),
  },
  kpi_publication: {
    run_id: { type: 'uuid', nullable: false },
    environment: { type: 'text', nullable: false },
    report_date: { type: 'date', nullable: false },
    window_start: TSTZ3(false),
    window_end: TSTZ3(false),
    status: { type: 'text', nullable: false },
    frozen_batch: { type: 'jsonb', nullable: true },
    payload_sha256: { type: 'text', nullable: true },
    source_commit: { type: 'text', nullable: false },
    retry_chain_id: { type: 'uuid', nullable: false },
    attempt_count: { type: 'integer', nullable: false, hasDefault: true },
    last_error: { type: 'text', nullable: true },
    created_at: TSTZ3(false, true),
    updated_at: TSTZ3(false, true),
    accepted_at: TSTZ3(true),
    delivered_at: TSTZ3(true),
  },
};

/** Columnas de un índice, en orden, desde pg_index. */
const INDEX_INFO_SQL = `
  SELECT i.relname AS index_name,
         t.relname AS table_name,
         ix.indisunique AS is_unique,
         ix.indisprimary AS is_primary,
         array_agg(a.attname::text ORDER BY k.ord) AS columns
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
   WHERE n.nspname = $1
   GROUP BY i.relname, t.relname, ix.indisunique, ix.indisprimary`;

interface IndexRow {
  index_name: string;
  table_name: string;
  is_unique: boolean;
  is_primary: boolean;
  columns: string[];
}

async function tablesIn(db: DisposableSchema): Promise<string[]> {
  const { rows } = await db.client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY 1`,
    [db.schema],
  );
  return rows.map(row => row.table_name);
}

describe('NUT-85 — guarda de host de KPI_TEST_DATABASE_URL (siempre corre)', () => {
  it.each(['postgresql://u:p@localhost:5432/db', 'postgresql://u:p@127.0.0.1:55432/db', 'postgresql://u:p@[::1]:5432/db'])(
    'acepta host local %#',
    url => {
      expect(() => assertLocalHost(url)).not.toThrow();
    },
  );

  it.each([
    'postgresql://u:p@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require',
    'postgresql://u:p@db.example.com:5432/db',
    'postgresql://u:p@10.0.0.5:5432/db',
    'no-es-una-url',
  ])('rechaza host no local sin revelar la URL %#', url => {
    expect(() => assertLocalHost(url)).toThrow(/KPI_TEST_DATABASE_URL/);
    try {
      assertLocalHost(url);
    } catch (error) {
      expect((error as Error).message).not.toContain('u:p@');
      expect((error as Error).message).not.toContain(url);
    }
  });
});

describeIfKpiDb('NUT-85 A2/A4 — migración sobre Postgres desechable', () => {
  describe('schema vacío: aplicar todas las migraciones', () => {
    let db: DisposableSchema;
    let indexes: IndexRow[];

    beforeAll(async () => {
      expect(findKpiMigrationDirs()).toHaveLength(1);
      db = await createDisposableSchema();
      await applyMigrations(db.client, { upTo: findKpiMigrationDirs()[0] });
      indexes = (await db.client.query<IndexRow>(INDEX_INFO_SQL, [db.schema])).rows;
    });

    afterAll(async () => {
      await db?.drop();
    });

    it('crea las 5 tablas kpi_ en el schema de la migración', async () => {
      const tables = await tablesIn(db);
      expect(tables.filter(name => name.startsWith('kpi_')).sort()).toEqual([...KPI_TABLES].sort());
    });

    it.each(KPI_TABLES.map(table => [table]))('%s: columnas, tipos, nulabilidad y defaults', async table => {
      const { rows } = await db.client.query<{
        column_name: string;
        data_type: string;
        is_nullable: 'YES' | 'NO';
        datetime_precision: number | null;
        column_default: string | null;
      }>(
        `SELECT column_name, data_type, is_nullable, datetime_precision, column_default
           FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
        [db.schema, table],
      );
      const actual = Object.fromEntries(
        rows.map(row => {
          const spec: ColumnSpec = { type: row.data_type, nullable: row.is_nullable === 'YES' };
          if (row.data_type === 'timestamp with time zone') spec.precision = row.datetime_precision ?? undefined;
          if (row.data_type === 'timestamp with time zone' || row.column_name === 'attempt_count') {
            spec.hasDefault = row.column_default !== null;
          }
          return [row.column_name, spec];
        }),
      );
      const expected = Object.fromEntries(
        Object.entries(EXPECTED_COLUMNS[table]).map(([column, spec]) => [
          column,
          spec.type === 'timestamp with time zone' || column === 'attempt_count'
            ? { ...spec, hasDefault: spec.hasDefault ?? false }
            : { type: spec.type, nullable: spec.nullable },
        ]),
      );
      expect(actual).toEqual(expected);

      // Los ids los genera la aplicación: sin default en la base.
      const idColumn = KPI_PRIMARY_KEYS[table].column;
      expect(rows.find(row => row.column_name === idColumn)?.column_default ?? null).toBeNull();
    });

    it('existen todos los CHECK por nombre (pg_constraint) y ninguna FK en tablas kpi_', async () => {
      const { rows } = await db.client.query<{ table_name: string; conname: string; contype: string }>(
        `SELECT t.relname AS table_name, c.conname, c.contype
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = $1 AND t.relname LIKE 'kpi\\_%'`,
        [db.schema],
      );
      for (const table of KPI_TABLES) {
        const checks = rows
          .filter(row => row.table_name === table && row.contype === 'c')
          .map(row => row.conname)
          .sort();
        expect({ table, checks }).toEqual({ table, checks: [...KPI_CHECK_CONSTRAINTS[table]].sort() });

        const pks = rows.filter(row => row.table_name === table && row.contype === 'p').map(row => row.conname);
        expect({ table, pks }).toEqual({ table, pks: [KPI_PRIMARY_KEYS[table].name] });
      }
      expect(rows.filter(row => row.contype === 'f')).toEqual([]);
    });

    it('existen las 4 UNIQUE y los índices con sus columnas (pg_index)', () => {
      for (const spec of KPI_UNIQUE_INDEXES) {
        const found = indexes.find(row => row.index_name === spec.name);
        expect({ name: spec.name, found: found && { ...found } }).toEqual({
          name: spec.name,
          found: { index_name: spec.name, table_name: spec.table, is_unique: true, is_primary: false, columns: [...spec.columns] },
        });
      }
      for (const spec of [...KPI_INDEXES, ...BUSINESS_CREATED_AT_INDEXES]) {
        const found = indexes.find(row => row.index_name === spec.name);
        expect({ name: spec.name, found: found && { ...found } }).toEqual({
          name: spec.name,
          found: { index_name: spec.name, table_name: spec.table, is_unique: false, is_primary: false, columns: [...spec.columns] },
        });
      }
      const kpiNonPk = indexes
        .filter(row => row.table_name.startsWith('kpi_') && !row.is_primary)
        .map(row => row.index_name)
        .sort();
      expect(kpiNonPk).toEqual([...KPI_UNIQUE_INDEXES, ...KPI_INDEXES].map(spec => spec.name).sort());
    });
  });

  describe('schema con datos: la migración NUT-85 no cambia tablas de negocio', () => {
    let db: DisposableSchema;

    const BUSINESS_SNAPSHOT_TABLES = ['users', 'recipes', 'meal_plans'] as const;

    async function snapshotBusiness(): Promise<Record<string, unknown>> {
      const snapshot: Record<string, unknown> = {};
      for (const table of await tablesIn(db)) {
        if (table.startsWith('kpi_')) continue;
        const count = await db.client.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${table}"`);
        snapshot[`count:${table}`] = count.rows[0].n;
      }
      for (const table of BUSINESS_SNAPSHOT_TABLES) {
        const rows = await db.client.query<{ row: unknown }>(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY t."id"`);
        snapshot[`rows:${table}`] = rows.rows.map(row => row.row);
        const columns = await db.client.query<{ c: string }>(
          `SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS c
             FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
          [db.schema, table],
        );
        snapshot[`columns:${table}`] = columns.rows.map(row => row.c);
      }
      return snapshot;
    }

    beforeAll(async () => {
      expect(findKpiMigrationDirs()).toHaveLength(1);
      db = await createDisposableSchema();
      await applyMigrations(db.client, { upTo: PRE_KPI_BASELINE_MIGRATION });
      await db.client.query(`
        INSERT INTO users (id, email, "passwordHash", name, "updatedAt") VALUES
          ('it-user-1', 'one@example.test', 'hash-1', 'Uno', '2026-10-01T10:00:00.123Z'),
          ('it-user-2', 'two@example.test', 'hash-2', NULL, '2026-10-02T11:00:00.456Z');
        INSERT INTO recipes (id, title, description, "prepMinutes", "cookMinutes", ingredients, instructions, "updatedAt") VALUES
          ('it-recipe-1', 'Ensalada', 'Fresca', 5, 0, '[{"name":"lechuga"}]', ARRAY['Lavar','Servir'], '2026-10-03T12:00:00.000Z'),
          ('it-recipe-2', 'Guiso', 'Caliente', 15, 60, '[]', ARRAY['Cocinar'], '2026-10-04T13:00:00.000Z');
        INSERT INTO meal_plans (id, "userId", "startDate", "endDate", "updatedAt") VALUES
          ('it-plan-1', 'it-user-1', '2026-10-05T00:00:00Z', '2026-10-11T00:00:00Z', '2026-10-05T09:00:00.789Z');
      `);
    });

    afterAll(async () => {
      await db?.drop();
    });

    it('conteos y contenido de users/recipes/meal_plans idénticos antes y después de la migración NUT-85', async () => {
      const before = await snapshotBusiness();
      expect(before['count:users']).toBe('2');
      expect(before['count:recipes']).toBe('2');
      expect(before['count:meal_plans']).toBe('1');

      const applied = await applyMigrations(db.client, { after: PRE_KPI_BASELINE_MIGRATION, upTo: findKpiMigrationDirs()[0] });
      expect(applied).toEqual(findKpiMigrationDirs());

      const after = await snapshotBusiness();
      expect(after).toEqual(before);

      const tables = await tablesIn(db);
      expect(tables.filter(name => name.startsWith('kpi_')).sort()).toEqual([...KPI_TABLES].sort());

      const { rows } = await db.client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2::text[]) ORDER BY 1`,
        [db.schema, BUSINESS_CREATED_AT_INDEXES.map(spec => spec.name)],
      );
      expect(rows.map(row => row.indexname)).toEqual(BUSINESS_CREATED_AT_INDEXES.map(spec => spec.name).sort());
    });
  });
});
