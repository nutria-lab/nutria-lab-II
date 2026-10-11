// NUT-85 T1 — A1 (+ base de J2). Test estático: lee los .prisma como texto, no toca ninguna base.
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { KPI_INDEXES, KPI_PRISMA_FILE, KPI_UNIQUE_INDEXES, PRISMA_DIR } from './kpi-test-db.fixture';

const MODEL_TABLES: Record<string, string> = {
  KpiHttpEvent: 'kpi_http_event',
  KpiDependencyEvent: 'kpi_dependency_event',
  KpiHealthSample: 'kpi_health_sample',
  KpiSnapshot: 'kpi_snapshot',
  KpiPublication: 'kpi_publication',
};

const TABLE_MODELS: Record<string, string> = Object.fromEntries(
  Object.entries(MODEL_TABLES).map(([model, table]) => [table, model]),
);

interface FieldSpec {
  name: string;
  /** Tipo Prisma, con `?` si es opcional. */
  type: string;
  /** Columna SQL; si difiere del nombre del campo exige @map. */
  column: string;
  db?: string;
  id?: boolean;
  /** Atributos adicionales que deben aparecer textualmente. */
  extra?: string[];
}

const TS3 = 'Timestamptz(3)';

const FIELDS: Record<string, FieldSpec[]> = {
  KpiHttpEvent: [
    { name: 'id', type: 'String', column: 'id', db: 'Uuid', id: true },
    { name: 'environment', type: 'String', column: 'environment' },
    { name: 'operation', type: 'String', column: 'operation' },
    { name: 'startedAt', type: 'DateTime', column: 'started_at', db: TS3 },
    { name: 'finishedAt', type: 'DateTime?', column: 'finished_at', db: TS3 },
    { name: 'durationMs', type: 'Float?', column: 'duration_ms', db: 'DoublePrecision' },
    { name: 'httpStatus', type: 'Int?', column: 'http_status', db: 'SmallInt' },
    { name: 'outcome', type: 'String', column: 'outcome' },
    { name: 'recordedAt', type: 'DateTime', column: 'recorded_at', db: TS3, extra: ['@default(now())'] },
  ],
  KpiDependencyEvent: [
    { name: 'id', type: 'String', column: 'id', db: 'Uuid', id: true },
    { name: 'environment', type: 'String', column: 'environment' },
    { name: 'operationId', type: 'String', column: 'operation_id', db: 'Uuid' },
    { name: 'dependency', type: 'String', column: 'dependency' },
    { name: 'attempt', type: 'Int', column: 'attempt' },
    { name: 'startedAt', type: 'DateTime', column: 'started_at', db: TS3 },
    { name: 'finishedAt', type: 'DateTime?', column: 'finished_at', db: TS3 },
    { name: 'durationMs', type: 'Float?', column: 'duration_ms', db: 'DoublePrecision' },
    { name: 'outcome', type: 'String', column: 'outcome' },
    { name: 'recordedAt', type: 'DateTime', column: 'recorded_at', db: TS3, extra: ['@default(now())'] },
  ],
  KpiHealthSample: [
    { name: 'id', type: 'String', column: 'id', db: 'Uuid', id: true },
    { name: 'environment', type: 'String', column: 'environment' },
    { name: 'scheduledFor', type: 'DateTime', column: 'scheduled_for', db: TS3 },
    { name: 'measuredAt', type: 'DateTime', column: 'measured_at', db: TS3 },
    { name: 'apiOk', type: 'Boolean?', column: 'api_ok' },
    { name: 'databaseOk', type: 'Boolean?', column: 'database_ok' },
    { name: 'outcome', type: 'String', column: 'outcome' },
    { name: 'reason', type: 'String?', column: 'reason' },
  ],
  KpiSnapshot: [
    { name: 'id', type: 'String', column: 'id', db: 'Uuid', id: true },
    { name: 'environment', type: 'String', column: 'environment' },
    { name: 'reportDate', type: 'DateTime', column: 'report_date', db: 'Date' },
    { name: 'windowStart', type: 'DateTime', column: 'window_start', db: TS3 },
    { name: 'windowEnd', type: 'DateTime', column: 'window_end', db: TS3 },
    { name: 'snapshotKind', type: 'String', column: 'snapshot_kind' },
    { name: 'kpiId', type: 'String', column: 'kpi_id' },
    { name: 'value', type: 'Float?', column: 'value', db: 'DoublePrecision' },
    { name: 'quality', type: 'String', column: 'quality' },
    { name: 'reason', type: 'String?', column: 'reason' },
    { name: 'sampleCount', type: 'BigInt', column: 'sample_count' },
    { name: 'measuredAt', type: 'DateTime', column: 'measured_at', db: TS3 },
  ],
  KpiPublication: [
    { name: 'runId', type: 'String', column: 'run_id', db: 'Uuid', id: true },
    { name: 'environment', type: 'String', column: 'environment' },
    { name: 'reportDate', type: 'DateTime', column: 'report_date', db: 'Date' },
    { name: 'windowStart', type: 'DateTime', column: 'window_start', db: TS3 },
    { name: 'windowEnd', type: 'DateTime', column: 'window_end', db: TS3 },
    { name: 'status', type: 'String', column: 'status' },
    { name: 'frozenBatch', type: 'Json?', column: 'frozen_batch', db: 'JsonB' },
    { name: 'payloadSha256', type: 'String?', column: 'payload_sha256' },
    { name: 'sourceCommit', type: 'String', column: 'source_commit' },
    { name: 'retryChainId', type: 'String', column: 'retry_chain_id', db: 'Uuid' },
    { name: 'attemptCount', type: 'Int', column: 'attempt_count', extra: ['@default(0)'] },
    { name: 'lastError', type: 'String?', column: 'last_error' },
    { name: 'createdAt', type: 'DateTime', column: 'created_at', db: TS3, extra: ['@default(now())'] },
    { name: 'updatedAt', type: 'DateTime', column: 'updated_at', db: TS3, extra: ['@default(now())'] },
    { name: 'acceptedAt', type: 'DateTime?', column: 'accepted_at', db: TS3 },
    { name: 'deliveredAt', type: 'DateTime?', column: 'delivered_at', db: TS3 },
  ],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Devuelve el cuerpo de cada `model X { ... }` sin comentarios `//`. */
function parseModels(source: string): Map<string, string> {
  const models = new Map<string, string>();
  const withoutComments = source.replace(/\r\n/g, '\n').replace(/\/\/.*$/gm, '');
  const pattern = /^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutComments)) !== null) {
    models.set(match[1], match[2]);
  }
  return models;
}

function fieldLines(body: string): string[] {
  return body
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('@@'));
}

function blockAttributes(body: string): string[] {
  return body
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('@@'));
}

function findField(body: string, name: string): string | undefined {
  return fieldLines(body).find(line => line.split(/\s+/)[0] === name);
}

function fieldListPattern(fields: readonly string[]): string {
  return fields.map(field => `\\s*${escapeRegExp(field)}\\s*`).join(',');
}

function normalizedModelHash(file: string): string {
  const text = fs
    .readFileSync(file, 'utf-8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '@@index([createdAt])')
    .join('\n')
    .trim();
  return createHash('sha256').update(text).digest('hex');
}

describe('NUT-85 A1 — kpi.prisma (estático)', () => {
  let models: Map<string, string>;

  beforeAll(() => {
    if (!fs.existsSync(KPI_PRISMA_FILE)) {
      throw new Error(
        `NUT-85 T1: no existe ${path.relative(PRISMA_DIR, KPI_PRISMA_FILE)} dentro de prisma/. ` +
          'Debe declarar KpiHttpEvent, KpiDependencyEvent, KpiHealthSample, KpiSnapshot y KpiPublication (design §5.1/§5.3/D19).',
      );
    }
    models = parseModels(fs.readFileSync(KPI_PRISMA_FILE, 'utf-8'));
  });

  it('kpi.prisma define los 5 modelos con @@map a los nombres del contrato', () => {
    expect([...models.keys()].sort()).toEqual(Object.keys(MODEL_TABLES).sort());
    for (const [model, table] of Object.entries(MODEL_TABLES)) {
      expect(blockAttributes(models.get(model)!)).toContain(`@@map("${table}")`);
    }
  });

  describe('usa Timestamptz(3), Date, Uuid, DoublePrecision, JsonB y SmallInt donde corresponde', () => {
    const cases = Object.entries(FIELDS).flatMap(([model, fields]) =>
      fields.map(field => [model, field.name, field] as const),
    );

    it.each(cases)('%s.%s', (model, _name, spec) => {
      const body = models.get(model);
      expect(body).toBeDefined();
      const line = findField(body!, spec.name);
      expect(line).toBeDefined();

      const tokens = line!.split(/\s+/);
      expect(tokens[1]).toBe(spec.type);

      if (spec.column !== spec.name) {
        expect(line).toContain(`@map("${spec.column}")`);
      } else {
        expect(line).not.toMatch(/@map\(/);
      }

      if (spec.db) {
        expect(line).toContain(`@db.${spec.db}`);
      } else {
        expect(line).not.toMatch(/@db\./);
      }

      for (const attribute of spec.extra ?? []) {
        expect(line).toContain(attribute);
      }

      if (spec.id) {
        expect(line).toMatch(/@id\b/);
        // D19: ids generados por la aplicación con crypto.randomUUID(), sin default en la base.
        expect(line).not.toMatch(/@default\(/);
      }
    });

    it.each(Object.keys(MODEL_TABLES))('%s no declara campos extra fuera del contrato', model => {
      const declared = fieldLines(models.get(model)!).map(line => line.split(/\s+/)[0]);
      expect(declared.sort()).toEqual(FIELDS[model].map(field => field.name).sort());
    });

    it('updatedAt de KpiPublication usa @default(now()) y NO @updatedAt (lo setea Lara explícitamente)', () => {
      const line = findField(models.get('KpiPublication')!, 'updatedAt');
      expect(line).toBeDefined();
      expect(line).not.toContain('@updatedAt');
    });

    it('las enumeraciones del contrato se guardan como String (sin enum de Prisma)', () => {
      const source = fs.readFileSync(KPI_PRISMA_FILE, 'utf-8');
      expect(source).not.toMatch(/^\s*enum\s+\w+/m);
    });
  });

  it('declara PK, UNIQUE e índices con map explícito', () => {
    for (const spec of KPI_UNIQUE_INDEXES) {
      const body = models.get(TABLE_MODELS[spec.table])!;
      const pattern = new RegExp(
        `^@@unique\\(\\[${fieldListPattern(spec.prismaFields!)}\\]\\s*,\\s*map:\\s*"${escapeRegExp(spec.name)}"\\s*\\)$`,
      );
      expect({ index: spec.name, matches: blockAttributes(body).some(line => pattern.test(line)) }).toEqual({
        index: spec.name,
        matches: true,
      });
    }

    for (const spec of KPI_INDEXES) {
      const body = models.get(TABLE_MODELS[spec.table])!;
      const pattern = new RegExp(
        `^@@index\\(\\[${fieldListPattern(spec.prismaFields!)}\\]\\s*,\\s*map:\\s*"${escapeRegExp(spec.name)}"\\s*\\)$`,
      );
      expect({ index: spec.name, matches: blockAttributes(body).some(line => pattern.test(line)) }).toEqual({
        index: spec.name,
        matches: true,
      });
    }

    // Cada modelo tiene exactamente una PK simple (@id) y ningún @@id compuesto.
    for (const model of Object.keys(MODEL_TABLES)) {
      const body = models.get(model)!;
      expect(fieldLines(body).filter(line => /@id\b/.test(line))).toHaveLength(1);
      expect(blockAttributes(body).some(line => line.startsWith('@@id'))).toBe(false);
    }

    // No hay más unique/index que los del contrato.
    const declaredUniques = [...models.values()].flatMap(body =>
      blockAttributes(body).filter(line => line.startsWith('@@unique')),
    );
    const declaredIndexes = [...models.values()].flatMap(body =>
      blockAttributes(body).filter(line => line.startsWith('@@index')),
    );
    expect(declaredUniques).toHaveLength(KPI_UNIQUE_INDEXES.length);
    expect(declaredIndexes).toHaveLength(KPI_INDEXES.length);
  });

  it('ningún modelo KPI tiene relaciones (@relation) ni FK', () => {
    const knownModels = new Set([
      ...Object.keys(MODEL_TABLES),
      'User',
      'MealPlan',
      'MealPlanDay',
      'PlannedMeal',
      'Recipe',
      'Ingredient',
      'NutritionProfile',
      'GenerationRun',
    ]);
    for (const [model, body] of models) {
      expect({ model, relation: /@relation\b/.test(body) }).toEqual({ model, relation: false });
      for (const line of fieldLines(body)) {
        const baseType = (line.split(/\s+/)[1] ?? '').replace(/[?[\]]/g, '');
        expect({ model, field: line, referencesModel: knownModels.has(baseType) }).toEqual({
          model,
          field: line,
          referencesModel: false,
        });
      }
    }
  });

  it('ninguna columna KPI tiene nombre de PII/URL/clave (user, email, url, token, key, title, query)', () => {
    const forbidden = /(user|email|url|token|key|title|query)/i;
    for (const [model, body] of models) {
      for (const line of fieldLines(body)) {
        const name = line.split(/\s+/)[0];
        const mapped = /@map\("([^"]+)"\)/.exec(line)?.[1];
        expect({ model, name, forbidden: forbidden.test(name) }).toEqual({ model, name, forbidden: false });
        if (mapped) {
          expect({ model, mapped, forbidden: forbidden.test(mapped) }).toEqual({ model, mapped, forbidden: false });
        }
      }
    }
  });
});

describe('NUT-85 A1/A3 — modelos de negocio', () => {
  const modelsDir = path.resolve(PRISMA_DIR, 'models');
  const mealPlanFile = path.resolve(modelsDir, 'mealPlan.prisma');
  const recipeFile = path.resolve(modelsDir, 'recipe.prisma');

  // Huella de mealPlan.prisma / recipe.prisma tal como estaban antes de NUT-85, ignorando
  // únicamente la línea `@@index([createdAt])` (CRLF→LF, sin espacios finales).
  // Si otro ticket cambia estos modelos, actualizar la huella en ese ticket.
  const BASELINE_HASHES: Record<string, string> = {
    'mealPlan.prisma': '65584b4604746d4666cc33aa1dfbf9137695143e37330451dc36ebe15fc34c8b',
    'recipe.prisma': 'e3b03f69b453712df71d940612bda3e21c2b0cff9533b8f053a3d1f64e2c0eaf',
  };

  it('los modelos de negocio sólo ganan @@index([createdAt]) en meal_plans y recipes', () => {
    for (const file of [mealPlanFile, recipeFile]) {
      const content = fs.readFileSync(file, 'utf-8');
      const occurrences = content.split(/\r?\n/).filter(line => line.trim() === '@@index([createdAt])');
      expect({ file: path.basename(file), createdAtIndexes: occurrences.length }).toEqual({
        file: path.basename(file),
        createdAtIndexes: 1,
      });
      expect({ file: path.basename(file), hash: normalizedModelHash(file) }).toEqual({
        file: path.basename(file),
        hash: BASELINE_HASHES[path.basename(file)],
      });
    }

    const otherBusinessModels = fs
      .readdirSync(modelsDir)
      .filter(name => name.endsWith('.prisma'))
      .filter(name => !['mealPlan.prisma', 'recipe.prisma', 'kpi.prisma'].includes(name));
    for (const name of otherBusinessModels) {
      const content = fs.readFileSync(path.resolve(modelsDir, name), 'utf-8');
      expect({ name, createdAtIndex: /@@index\(\[createdAt\]/.test(content) }).toEqual({
        name,
        createdAtIndex: false,
      });
    }
  });
});
