// NUT-85 T1 — A2 (nombres de CHECK) y A3 (aditiva, índices createdAt). Test estático:
// lee migration.sql como texto; no ejecuta Prisma ni toca ninguna base.
import {
  BUSINESS_CREATED_AT_INDEXES,
  KPI_CHECK_CONSTRAINTS,
  KPI_INDEXES,
  KPI_PRIMARY_KEYS,
  KPI_TABLES,
  KPI_UNIQUE_INDEXES,
  MIGRATIONS_DIR,
  PRE_KPI_BASELINE_MIGRATION,
  TELEMETRY_KPI_IDS,
  findKpiMigrationDirs,
  listMigrationDirs,
  readMigrationSql,
} from './kpi-test-db.fixture';

const BUSINESS_TABLES = [
  'users',
  'nutrition_profiles',
  'ingredients',
  'meal_plans',
  'meal_plan_days',
  'planned_meals',
  'recipes',
  'recipe_ingredients',
  'generation_runs',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ');
}

function columnsPattern(columns: readonly string[]): string {
  return columns.map(column => `\\s*"${escapeRegExp(column)}"\\s*`).join(',');
}

describe('NUT-85 A2/A3 — migración *_add_kpi_telemetry (estático)', () => {
  let sql: string;

  beforeAll(() => {
    const dirs = findKpiMigrationDirs();
    if (dirs.length !== 1) {
      throw new Error(
        `NUT-85 T1: se esperaba exactamente una carpeta <YYYYMMDDHHMMSS>_add_kpi_telemetry posterior a ` +
          `${PRE_KPI_BASELINE_MIGRATION} en ${MIGRATIONS_DIR}; se encontraron ${dirs.length}.`,
      );
    }
    sql = stripSqlComments(readMigrationSql(dirs[0]));
  });

  it('existe exactamente una migración *_add_kpi_telemetry posterior a 20260930220304_add_recipe_image', () => {
    const dirs = findKpiMigrationDirs();
    expect(dirs).toHaveLength(1);
    // Es la última migración: no queda nada intercalado después de NUT-85 en esta rama.
    const all = listMigrationDirs();
    expect(all[all.length - 1]).toBe(dirs[0]);
    expect(all.filter(name => /add_kpi_telemetry/.test(name))).toEqual(dirs);
  });

  it('crea las 5 tablas kpi_ sin calificar schema', () => {
    for (const table of KPI_TABLES) {
      expect({ table, created: new RegExp(`CREATE TABLE\\s+"${table}"\\s*\\(`).test(sql) }).toEqual({
        table,
        created: true,
      });
    }
    const createdTables = [...sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?("?[\w.]+"?(?:\."?\w+"?)?)/gi)].map(
      match => match[1].replace(/"/g, ''),
    );
    expect(createdTables.sort()).toEqual([...KPI_TABLES].sort());
    // Sin calificar schema (respeta search_path; los tests usan schemas descartables).
    expect(sql).not.toMatch(/"public"\s*\./i);
    expect(sql).not.toMatch(/\bpublic\s*\./i);
  });

  it('declara la PK de cada tabla con el nombre por defecto', () => {
    for (const table of KPI_TABLES) {
      const { name, column } = KPI_PRIMARY_KEYS[table];
      expect({
        table,
        pk: new RegExp(`CONSTRAINT\\s+"${name}"\\s+PRIMARY KEY\\s*\\(\\s*"${column}"\\s*\\)`).test(sql),
      }).toEqual({ table, pk: true });
    }
  });

  describe('contiene cada CHECK por nombre', () => {
    const cases = KPI_TABLES.flatMap(table => KPI_CHECK_CONSTRAINTS[table].map(name => [table, name] as const));

    it.each(cases)('%s: %s', (_table, name) => {
      expect(sql).toMatch(new RegExp(`CONSTRAINT\\s+"${escapeRegExp(name)}"\\s+CHECK\\s*\\(`));
    });

    it('no hay CHECK sin nombre ni con nombre fuera de la convención kpi_<tabla>_<regla>_check', () => {
      const allChecks = sql.match(/\bCHECK\s*\(/gi) ?? [];
      const namedChecks = [...sql.matchAll(/CONSTRAINT\s+"([^"]+)"\s+CHECK\s*\(/gi)].map(match => match[1]);
      expect(namedChecks).toHaveLength(allChecks.length);
      const expected = KPI_TABLES.flatMap(table => [...KPI_CHECK_CONSTRAINTS[table]]);
      expect([...namedChecks].sort()).toEqual([...expected].sort());
    });

    it('el CHECK de kpi_id enumera exactamente los 8 KPI de Telemetry', () => {
      const match = /CONSTRAINT\s+"kpi_snapshot_kpi_id_check"\s+CHECK\s*\(([^;]*?)\)\s*(?:,|;|\n\s*\))/i.exec(sql);
      expect(match).not.toBeNull();
      const literals = [...match![1].matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]).sort();
      expect(literals).toEqual([...TELEMETRY_KPI_IDS].sort());
    });

    it('el formato de payload_sha256 es 64 hex en minúscula (D20)', () => {
      expect(sql).toContain("'^[0-9a-f]{64}$'");
    });
  });

  it('contiene las 4 UNIQUE y los índices con los nombres del esquema Prisma', () => {
    for (const spec of KPI_UNIQUE_INDEXES) {
      const pattern = new RegExp(
        `CREATE UNIQUE INDEX\\s+"${spec.name}"\\s+ON\\s+"${spec.table}"\\s*\\(${columnsPattern(spec.columns)}\\)\\s*;`,
      );
      expect({ index: spec.name, present: pattern.test(sql) }).toEqual({ index: spec.name, present: true });
    }
    for (const spec of KPI_INDEXES) {
      const pattern = new RegExp(
        `CREATE INDEX\\s+"${spec.name}"\\s+ON\\s+"${spec.table}"\\s*\\(${columnsPattern(spec.columns)}\\)\\s*;`,
      );
      expect({ index: spec.name, present: pattern.test(sql) }).toEqual({ index: spec.name, present: true });
    }
    const created = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX\s+"([^"]+)"/gi)].map(match => match[1]).sort();
    expect(created).toEqual(
      [...KPI_UNIQUE_INDEXES, ...KPI_INDEXES, ...BUSINESS_CREATED_AT_INDEXES].map(spec => spec.name).sort(),
    );
  });

  it('crea los índices createdAt de meal_plans y recipes', () => {
    for (const spec of BUSINESS_CREATED_AT_INDEXES) {
      expect(sql).toMatch(
        new RegExp(`CREATE INDEX\\s+"${spec.name}"\\s+ON\\s+"${spec.table}"\\s*\\(\\s*"createdAt"\\s*\\)\\s*;`),
      );
    }
    // Sin CONCURRENTLY: Prisma corre la migración dentro de una transacción.
    expect(sql).not.toMatch(/\bCONCURRENTLY\b/i);
  });

  it('no contiene DROP, TRUNCATE, DELETE, UPDATE, RENAME, ALTER COLUMN, ALTER TABLE sobre tablas de negocio, CREATE EXTENSION ni TRIGGER', () => {
    const forbidden: Array<[string, RegExp]> = [
      ['DROP', /\bDROP\b/i],
      ['TRUNCATE', /\bTRUNCATE\b/i],
      ['DELETE', /\bDELETE\b/i],
      ['UPDATE', /\bUPDATE\b/i],
      ['INSERT', /\bINSERT\b/i],
      ['RENAME', /\bRENAME\b/i],
      ['ALTER COLUMN', /\bALTER\s+COLUMN\b/i],
      ['ALTER TYPE', /\bALTER\s+TYPE\b/i],
      ['EXTENSION', /\bEXTENSION\b/i],
      ['TRIGGER', /\bTRIGGER\b/i],
      ['FUNCTION', /\bFUNCTION\b/i],
      ['FOREIGN KEY', /\bFOREIGN\s+KEY\b/i],
      ['REFERENCES', /\bREFERENCES\b/i],
      ['CREATE TYPE', /\bCREATE\s+TYPE\b/i],
    ];
    for (const [label, pattern] of forbidden) {
      expect({ label, found: pattern.test(sql) }).toEqual({ label, found: false });
    }

    // ALTER TABLE sólo se tolera sobre tablas kpi_ y sólo para ADD CONSTRAINT.
    const alterStatements = sql.match(/ALTER\s+TABLE[^;]*;/gi) ?? [];
    for (const statement of alterStatements) {
      expect(statement).toMatch(/^ALTER\s+TABLE\s+"kpi_\w+"\s+ADD\s+CONSTRAINT\s+"kpi_\w+_check"\s+CHECK\s*\(/i);
    }
    for (const table of BUSINESS_TABLES) {
      expect({ table, altered: new RegExp(`ALTER\\s+TABLE\\s+"?${table}"?\\b`, 'i').test(sql) }).toEqual({
        table,
        altered: false,
      });
    }

    // Sobre tablas de negocio sólo se crean los 2 índices createdAt.
    const indexesOnBusiness = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX\s+"[^"]+"\s+ON\s+"([^"]+)"/gi)]
      .map(match => match[1])
      .filter(table => !table.startsWith('kpi_'));
    expect(indexesOnBusiness.sort()).toEqual(['meal_plans', 'recipes']);
  });
});
