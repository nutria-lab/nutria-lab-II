/**
 * NUT-114 — Block 2 (TDD red first): phased loader of the synthetic dataset.
 *
 * Expected API of `apps/api/prisma/synthetic/load.ts` (I/O only through the injected client; never reads process.env):
 *
 *   export type SeedPhase =
 *     | 'ingredients' | 'users' | 'profiles' | 'recipes' | 'plans' | 'days' | 'meals' | 'completions'
 *     | 'shopping-checks' | 'verify-bulk'
 *     | 'current-week:plan' | 'current-week:days' | 'current-week:meals' | 'current-week:completions'
 *     | 'current-week:shopping-checks' | 'verify-current-week';
 *
 *   export type SeedPhaseErrorCode =
 *     | 'batch_failed'           // a createMany batch threw (batch = 1-based batch number inside the phase)
 *     | 'missing_ids'            // expected ids not found after the phase (sample = some missing ids)
 *     | 'email_id_conflict'      // User.email exists with another id (sample = conflicting emails)
 *     | 'key_id_conflict'        // other unique key -> other id: Ingredient.name, NutritionProfile.userId,
 *                                //   MealPlanDay(mealPlanId, day), MealCompletion.plannedMealId,
 *                                //   ShoppingItemCheck(userId, planId, itemKey)
 *     | 'week_current_conflict'  // 00001 already has an isCurrent plan with another id for the current BA week
 *     | 'verify_failed'          // bulk / current-week verification (totals, 7x4 per plan, orphans) did not match
 *     | 'read_failed';           // a verification read threw; reported with the phase in progress, never its text
 *
 *   export class SeedPhaseError extends Error {
 *     readonly phase: SeedPhase;
 *     readonly code: SeedPhaseErrorCode;
 *     readonly batch?: number;
 *     readonly sample?: string[];
 *     // message: defaults to a text that contains the phase (and "lote <batch>" when batch is set); never contains
 *     // credentials, URLs or password hashes. opts.message overrides it (used for week_current_conflict, see below).
 *     constructor(phase: SeedPhase, code: SeedPhaseErrorCode, opts?: { batch?: number; sample?: string[]; message?: string });
 *   }
 *
 *   export type SeedTableKey =
 *     'ingredients' | 'users' | 'profiles' | 'recipes' | 'plans' | 'days' | 'meals' | 'completions' | 'shoppingChecks';
 *
 *   export interface LoadReport {
 *     // counts = expected synthetic rows present in the DB after verification (bulk: equals the dataset array lengths)
 *     bulk: { ok: true; counts: Record<SeedTableKey, number> };
 *     currentWeek:
 *       | { ok: true; counts: { plans: 1; days: 7; meals: 28; completions: number; shoppingChecks: number } }
 *       | { ok: false; error: SeedPhaseError };
 *   }
 *
 *   export async function loadSynthetic(
 *     client: SyntheticSeedClient,   // see "client contract" below; a real PrismaClient satisfies it
 *     opts: { dataset: SyntheticDataset; now: Date; batchSize: number; log?: (line: string) => void },
 *   ): Promise<LoadReport>;
 *
 * Client contract (delegates user, nutritionProfile, ingredient, recipe, mealPlan, mealPlanDay, plannedMeal,
 * mealCompletion, shoppingItemCheck):
 *   - writes ONLY via `createMany({ data, skipDuplicates: true })`, 1 <= data.length <= batchSize;
 *     never create / update / updateMany / upsert / delete / deleteMany;
 *   - reads via `findMany({ where?, select?, orderBy? })` / `count({ where? })` / `findFirst({ where? })`, where `where`
 *     is a conjunction of scalar equality and `{ in: [...] }` (no relation filters, no nested select/include).
 *
 * Behavior:
 *   - Bulk phases in order ingredients -> users -> profiles -> recipes -> plans -> days -> meals -> completions ->
 *     shopping-checks -> verify-bulk. After each phase: unique-key -> id checks FIRST (a key pointing to another id is a
 *     *_id_conflict, not missing_ids), then findMany by expected ids (missing -> missing_ids). A failing phase stops the
 *     load: later phases are not written. A bulk failure REJECTS and current-week is not executed.
 *   - Bulk completions: mealUpdatedAtSnapshot / recipeIdSnapshot come from PlannedMeal rows RE-READ from the DB.
 *   - Current week (00001 only, BA Monday from `now`, ids …-9YYYYMMDD…): plan -> days -> meals -> re-read meals ->
 *     completions = buildCurrentWeekCompletions(re-read rows) (insert-or-skip; only days strictly before BA today) ->
 *     shopping checks = buildCurrentWeekShoppingChecks(plan re-read from DB, days by date, meals by id) -> verify.
 *     A current-week failure does NOT reject: report.currentWeek = { ok: false, error } and bulk rows stay.
 *   - week_current_conflict (phase 'current-week:plan') message, exactly:
 *     "current-week: demo.seed.00001 ya tiene un plan actual creado fuera del seed para la semana YYYY-MM-DD. La carga
 *      masiva quedó completa y verificada. Para el recorrido, usá ese plan o corré el seed en otra base. No se borró ni
 *      modificó ningún dato."
 *     Nothing of the current week (days, meals, marks, checks) is written; the foreign plan is never touched.
 */
import { DayOfWeek, MealType } from '@/generated/prisma/client';
import { mealCompletionSnapshotsMatch } from '@/modules/adherence/effective-meal-status';
import { transformShoppingList } from '@/modules/shopping-list/shopping-list.transform';
import type { ShoppingListPlan } from '@/modules/shopping-list/shopping-list.types';
import {
  ARROZ_INTEGRAL_SEED,
  PECHUGA_POLLO_SEED,
  RECETA_POLLO_ID,
  RECETA_POLLO_SEED,
  synthId,
  syntheticEmail,
} from '../seed-data';
import {
  SyntheticDataset,
  buildCurrentWeek,
  buildCurrentWeekCompletions,
  buildCurrentWeekShoppingChecks,
  generateSyntheticDataset,
} from '../../../prisma/synthetic/generate';
import { SeedPhaseError, loadSynthetic } from '../../../prisma/synthetic/load';

jest.setTimeout(120_000);

// ---------- expected API shapes (declared locally so this spec type-checks on its own) ----------

type SpecTable =
  'ingredients' | 'users' | 'profiles' | 'recipes' | 'plans' | 'days' | 'meals' | 'completions' | 'shoppingChecks';
type SpecCounts = Record<SpecTable, number>;
type SpecCurrentWeekCounts = Pick<SpecCounts, 'plans' | 'days' | 'meals' | 'completions' | 'shoppingChecks'>;
interface SpecSeedPhaseError extends Error {
  phase: string;
  code: string;
  batch?: number;
  sample?: string[];
}
interface SpecLoadReport {
  bulk: { ok: true; counts: SpecCounts };
  currentWeek: { ok: true; counts: SpecCurrentWeekCounts } | { ok: false; error: SpecSeedPhaseError };
}

// ---------- in-memory fake Prisma client with createMany skipDuplicates semantics ----------

type Row = Record<string, any>;
type ModelName =
  | 'user' | 'nutritionProfile' | 'ingredient' | 'recipe' | 'mealPlan' | 'mealPlanDay' | 'plannedMeal'
  | 'mealCompletion' | 'shoppingItemCheck';
const MODELS: ModelName[] = [
  'user', 'nutritionProfile', 'ingredient', 'recipe', 'mealPlan', 'mealPlanDay', 'plannedMeal', 'mealCompletion',
  'shoppingItemCheck',
];
const TABLE_MODEL: Record<SpecTable, ModelName> = {
  ingredients: 'ingredient',
  users: 'user',
  profiles: 'nutritionProfile',
  recipes: 'recipe',
  plans: 'mealPlan',
  days: 'mealPlanDay',
  meals: 'plannedMeal',
  completions: 'mealCompletion',
  shoppingChecks: 'shoppingItemCheck',
};
const DATASET_KEY: Record<SpecTable, keyof SyntheticDataset> = {
  ingredients: 'ingredients',
  users: 'users',
  profiles: 'profiles',
  recipes: 'recipes',
  plans: 'plans',
  days: 'days',
  meals: 'meals',
  completions: 'completions',
  shoppingChecks: 'shoppingChecks',
};

interface UniqueRule { fields: string[]; when?: (row: Row) => boolean }
const UNIQUES: Record<ModelName, UniqueRule[]> = {
  user: [{ fields: ['email'] }],
  nutritionProfile: [{ fields: ['userId'] }],
  ingredient: [{ fields: ['name'] }],
  recipe: [],
  // Partial unique index meal_plans_user_week_current_key: ("userId","startDate") WHERE "isCurrent" = true.
  mealPlan: [{ fields: ['userId', 'startDate'], when: (row) => row.isCurrent === true }],
  mealPlanDay: [{ fields: ['mealPlanId', 'day'] }],
  plannedMeal: [],
  mealCompletion: [{ fields: ['plannedMealId'] }],
  shoppingItemCheck: [{ fields: ['userId', 'planId', 'itemKey'] }],
};
const FOREIGN_KEYS: Record<ModelName, Array<[string, ModelName]>> = {
  user: [],
  nutritionProfile: [['userId', 'user']],
  ingredient: [],
  recipe: [],
  mealPlan: [['userId', 'user']],
  mealPlanDay: [['mealPlanId', 'mealPlan']],
  plannedMeal: [['dayId', 'mealPlanDay'], ['recipeId', 'recipe']],
  mealCompletion: [['userId', 'user'], ['plannedMealId', 'plannedMeal']],
  shoppingItemCheck: [['userId', 'user'], ['planId', 'mealPlan']],
};
const DEFAULTS: Partial<Record<ModelName, Row>> = {
  mealPlan: { isCurrent: true, version: 1 },
  recipe: { origin: 'MANUAL' },
};

const norm = (value: unknown): string =>
  value instanceof Date ? `D:${value.toISOString()}` : value === undefined ? 'U:' : `V:${JSON.stringify(value)}`;

/**
 * Deep copy that keeps Date instances in this (jest) realm. `structuredClone` would create Dates of Node's realm, which
 * breaks `instanceof Date` here and therefore `norm` (date equality in where clauses) and toBeInstanceOf(Date).
 */
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Row).map(([key, item]) => [key, clone(item)])) as T;
  }
  return value;
}

function prismaError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function compileWhere(where: Row | undefined): (row: Row) => boolean {
  if (!where) return () => true;
  const checks = Object.entries(where).map(([field, cond]) => {
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const keys = Object.keys(cond);
      if (keys.length === 1 && keys[0] === 'in' && Array.isArray(cond.in)) {
        const set = new Set((cond.in as unknown[]).map(norm));
        return (row: Row) => set.has(norm(row[field]));
      }
      throw new Error(`FakeSeedDb: unsupported where on "${field}" (only equality and { in } are allowed)`);
    }
    const expected = norm(cond);
    return (row: Row) => norm(row[field]) === expected;
  });
  return (row) => checks.every((check) => check(row));
}

function project(row: Row, select: Row | undefined): Row {
  const copy = clone(row);
  if (!select) return copy;
  const out: Row = {};
  for (const [key, flag] of Object.entries(select)) {
    if (flag !== true) throw new Error(`FakeSeedDb: unsupported nested select on "${key}"`);
    out[key] = copy[key];
  }
  return out;
}

interface FailureRule { model: ModelName; nth?: number; match?: (rows: Row[]) => boolean; fired: boolean }

class FakeSeedDb {
  private readonly tables = new Map<ModelName, Map<string, Row>>();
  private readonly calls = new Map<ModelName, number>();
  private readonly failures: FailureRule[] = [];
  private readonly dropped = new Set<string>();
  private tick = Date.parse('2026-11-01T00:00:00.000Z');
  readonly createManyCalls: Array<{ model: ModelName; size: number; skipDuplicates: unknown }> = [];
  readonly forbiddenCalls: string[] = [];
  readonly client: Record<ModelName, Record<string, (args?: any) => Promise<any>>>;

  constructor() {
    for (const model of MODELS) this.tables.set(model, new Map());
    const forbidden = (model: ModelName, method: string) => async () => {
      this.forbiddenCalls.push(`${model}.${method}`);
      throw new Error(`FakeSeedDb: ${model}.${method} is forbidden for synthetic data`);
    };
    this.client = Object.fromEntries(MODELS.map((model) => [model, {
      createMany: async (args: { data: Row[]; skipDuplicates?: boolean }) => this.createMany(model, args),
      findMany: async (args: { where?: Row; select?: Row; orderBy?: Row } = {}) => this.findMany(model, args),
      findFirst: async (args: { where?: Row; select?: Row } = {}) => this.findMany(model, args)[0] ?? null,
      count: async (args: { where?: Row } = {}) => this.findMany(model, args).length,
      create: forbidden(model, 'create'),
      update: forbidden(model, 'update'),
      updateMany: forbidden(model, 'updateMany'),
      upsert: forbidden(model, 'upsert'),
      delete: forbidden(model, 'delete'),
      deleteMany: forbidden(model, 'deleteMany'),
    }])) as unknown as FakeSeedDb['client'];
  }

  /** Pre-existing rows (bypass constraints; defaults and timestamps applied). */
  seed(model: ModelName, rows: Row[]): void {
    for (const row of rows) {
      const stored = this.withDefaults(model, row);
      this.tables.get(model)!.set(stored.id, stored);
    }
  }

  failCreateMany(model: ModelName, rule: { nth?: number; match?: (rows: Row[]) => boolean }): void {
    this.failures.push({ model, ...rule, fired: false });
  }

  /** Rows with this id are silently lost on insert (createMany still counts them). */
  dropOnInsert(id: string): void {
    this.dropped.add(id);
  }

  rows(model: ModelName): Row[] {
    return [...this.tables.get(model)!.values()].map((row) => clone(row));
  }

  get(model: ModelName, id: string): Row | undefined {
    const row = this.tables.get(model)!.get(id);
    return row ? clone(row) : undefined;
  }

  counts(): Record<ModelName, number> {
    return Object.fromEntries(MODELS.map((model) => [model, this.tables.get(model)!.size])) as Record<ModelName, number>;
  }

  private withDefaults(model: ModelName, row: Row): Row {
    const at = new Date(this.tick++);
    const stored: Row = { ...(DEFAULTS[model] ?? {}), ...clone(row) };
    if (stored.createdAt === undefined) stored.createdAt = at;
    if (stored.updatedAt === undefined) stored.updatedAt = at; // @updatedAt is set by Prisma on insert
    return stored;
  }

  private createMany(model: ModelName, args: { data: Row[]; skipDuplicates?: boolean }): { count: number } {
    const data = Array.isArray(args?.data) ? args.data : [];
    this.createManyCalls.push({ model, size: data.length, skipDuplicates: args?.skipDuplicates });
    const n = (this.calls.get(model) ?? 0) + 1;
    this.calls.set(model, n);
    const failure = this.failures.find((rule) => !rule.fired && rule.model === model
      && (rule.nth === undefined || rule.nth === n) && (rule.match === undefined || rule.match(data)));
    if (failure) {
      failure.fired = true;
      throw prismaError('P1017', `FakeSeedDb: injected failure on ${model}.createMany call ${n}`);
    }

    const table = this.tables.get(model)!;
    const rules = UNIQUES[model];
    const applies = (rule: UniqueRule, row: Row) => !rule.when || rule.when(row);
    const keyOf = (rule: UniqueRule, row: Row) => rule.fields.map((field) => norm(row[field])).join('|');
    const keys = rules.map((rule) => new Set([...table.values()].filter((row) => applies(rule, row)).map((row) => keyOf(rule, row))));
    const stagedIds = new Set<string>();
    const staged: Row[] = [];
    for (const raw of data) {
      const row = this.withDefaults(model, raw);
      const taken = table.has(row.id) || stagedIds.has(row.id)
        || rules.some((rule, i) => applies(rule, row) && keys[i].has(keyOf(rule, row)));
      if (taken) {
        if (!args.skipDuplicates) throw prismaError('P2002', `FakeSeedDb: unique violation on ${model}`);
        continue;
      }
      for (const [field, target] of FOREIGN_KEYS[model]) {
        const value = row[field];
        if (value === null || value === undefined) continue;
        if (!this.tables.get(target)!.has(value)) {
          throw prismaError('P2003', `FakeSeedDb: foreign key ${model}.${field} -> ${target} violated`);
        }
      }
      stagedIds.add(row.id);
      rules.forEach((rule, i) => { if (applies(rule, row)) keys[i].add(keyOf(rule, row)); });
      staged.push(row);
    }
    // One INSERT ... ON CONFLICT DO NOTHING statement: all-or-nothing.
    for (const row of staged) if (!this.dropped.has(row.id)) table.set(row.id, row);
    return { count: staged.length };
  }

  private findMany(model: ModelName, args: { where?: Row; select?: Row; orderBy?: Row }): Row[] {
    const predicate = compileWhere(args.where);
    let result = [...this.tables.get(model)!.values()].filter(predicate);
    if (args.orderBy) {
      const [[field, dir]] = Object.entries(args.orderBy);
      const sign = dir === 'desc' ? -1 : 1;
      result = [...result].sort((a, b) => (norm(a[field]) < norm(b[field]) ? -sign : norm(a[field]) > norm(b[field]) ? sign : 0));
    }
    return result.map((row) => project(row, args.select));
  }
}

// ---------- fixtures ----------

const USERS = 60;
const BATCH = 500;
// Real bcrypt hash (cost 4) of 'demo-walkthrough-pass' (same as the Block 1 specs).
const DEMO_HASH = '$2b$04$QL597mIXc6JauPDhUTUPR.uUjvBlSb9NxRWu5xn4egJ78KrMILTNK';
const MON = new Date('2026-11-09T15:00:00.000Z'); // Monday 12:00 BA
const WED = new Date('2026-11-11T15:00:00.000Z'); // Wednesday 12:00 BA
const NEXT_WED = new Date('2026-11-18T15:00:00.000Z'); // Wednesday of the following week
const WEEK_A = '2026-11-09';
const WEEK_B = '2026-11-16';
const DEMO_USER_ID = synthId('users', 1);
const FOREIGN_ID = 'f0e1d2c3-0000-4000-8000-0000000000aa';
const ACTIONABLE = (monday: string) =>
  `current-week: demo.seed.00001 ya tiene un plan actual creado fuera del seed para la semana ${monday}. ` +
  'La carga masiva quedó completa y verificada. Para el recorrido, usá ese plan o corré el seed en otra base. ' +
  'No se borró ni modificó ningún dato.';

const datasets = new Map<number, SyntheticDataset>();
function datasetFor(now: Date): SyntheticDataset {
  let dataset = datasets.get(now.getTime());
  if (!dataset) {
    dataset = generateSyntheticDataset({ users: USERS, demoPasswordHash: DEMO_HASH, now });
    datasets.set(now.getTime(), dataset);
  }
  return dataset;
}

async function run(fake: FakeSeedDb, now: Date, logs: string[] = []): Promise<SpecLoadReport> {
  return (await loadSynthetic(fake.client as never, {
    dataset: datasetFor(now),
    now,
    batchSize: BATCH,
    log: (line: string) => logs.push(line),
  })) as SpecLoadReport;
}

async function rejectionOf(promise: Promise<unknown>): Promise<SpecSeedPhaseError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SeedPhaseError);
    return error as SpecSeedPhaseError;
  }
  throw new Error('expected loadSynthetic to reject with SeedPhaseError');
}

const isCurrentWeekId = (id: string) => id.slice(-12).startsWith('9');
const cwIndex = (monday: string, suffix: string) => Number(`9${monday.replace(/-/g, '')}${suffix}`);
const cwPlanId = (monday: string) => synthId('mealPlans', cwIndex(monday, '000'));
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

function expectedBulk(dataset: SyntheticDataset): SpecCounts {
  return Object.fromEntries((Object.keys(TABLE_MODEL) as SpecTable[])
    .map((table) => [table, (dataset[DATASET_KEY[table]] as unknown[]).length])) as SpecCounts;
}

/** Rows of `table` in the fake whose id is one of the dataset's expected bulk ids. */
function bulkCountsIn(fake: FakeSeedDb, dataset: SyntheticDataset): SpecCounts {
  return Object.fromEntries((Object.keys(TABLE_MODEL) as SpecTable[]).map((table) => {
    const ids = new Set((dataset[DATASET_KEY[table]] as Array<{ id: string }>).map((row) => row.id));
    return [table, fake.rows(TABLE_MODEL[table]).filter((row) => ids.has(row.id)).length];
  })) as SpecCounts;
}

function currentWeekRows(fake: FakeSeedDb, monday: string) {
  const planId = cwPlanId(monday);
  const plan = fake.get('mealPlan', planId);
  const days = fake.rows('mealPlanDay').filter((day) => day.mealPlanId === planId)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const dayIds = new Set(days.map((day) => day.id));
  const meals = fake.rows('plannedMeal').filter((meal) => dayIds.has(meal.dayId))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const mealIds = new Set(meals.map((meal) => meal.id));
  const marks = fake.rows('mealCompletion').filter((mark) => mealIds.has(mark.plannedMealId));
  const checks = fake.rows('shoppingItemCheck').filter((check) => check.planId === planId);
  return { planId, plan, days, meals, marks, checks };
}

/** ShoppingListPlan of the plan as the app reads it (days by date, meals in B/L/S/D id order). */
function shoppingPlanFromFake(fake: FakeSeedDb, planId: string): NonNullable<ShoppingListPlan> {
  const plan = fake.get('mealPlan', planId)!;
  const days = fake.rows('mealPlanDay').filter((day) => day.mealPlanId === planId)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return {
    id: plan.id,
    version: plan.version,
    updatedAt: plan.updatedAt,
    days: days.map((day) => ({
      meals: fake.rows('plannedMeal').filter((meal) => meal.dayId === day.id)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((meal) => {
          const recipe = meal.recipeId ? fake.get('recipe', meal.recipeId) : undefined;
          return { id: meal.id, recipeId: meal.recipeId, recipe: recipe ? { id: recipe.id, ingredients: recipe.ingredients } : null };
        }),
    })),
  };
}

/** Same ShoppingListPlan built purely from the generator (independent of the fake). */
function shoppingPlanFromGenerator(dataset: SyntheticDataset, now: Date): { monday: string; plan: NonNullable<ShoppingListPlan> } {
  const week = buildCurrentWeek({ now, dataset });
  const recipes = new Map(dataset.recipes.map((recipe) => [recipe.id, recipe]));
  return {
    monday: week.monday,
    plan: {
      id: week.plan.id,
      version: 1,
      updatedAt: week.plan.startDate,
      days: week.days.map((day) => ({
        meals: week.meals.filter((meal) => meal.dayId === day.id).map((meal) => ({
          id: meal.id,
          recipeId: meal.recipeId,
          recipe: { id: meal.recipeId, ingredients: recipes.get(meal.recipeId)!.ingredients },
        })),
      })),
    },
  };
}

function seedBaseRows(fake: FakeSeedDb): Record<ModelName, Row[]> {
  const baseUserIds = [1, 2, 3].map((n) => `ba5e0001-0000-4000-8000-00000000000${n}`);
  const rows: Partial<Record<ModelName, Row[]>> = {
    user: baseUserIds.map((id, i) => ({
      id, email: `usuario.prueba${i + 1}@nutria.com`, name: `Usuario Prueba ${i + 1}`, passwordHash: '$2b$10$base-user-hash',
    })),
    nutritionProfile: baseUserIds.map((userId, i) => ({
      id: `ba5e0006-0000-4000-8000-00000000000${i + 1}`, userId, goal: 'MAINTAIN', diet: 'ALL',
      excludedIngredients: [], cookTimePreference: 'STANDARD',
    })),
    ingredient: [
      { id: 'ba5e0007-0000-4000-8000-000000000001', ...PECHUGA_POLLO_SEED },
      { id: 'ba5e0007-0000-4000-8000-000000000002', ...ARROZ_INTEGRAL_SEED },
    ],
    recipe: [{ id: RECETA_POLLO_ID, ...RECETA_POLLO_SEED }],
    mealPlan: [{
      id: 'ba5e0003-0000-4000-8000-000000000001', userId: baseUserIds[0],
      startDate: new Date(`${WEEK_A}T00:00:00.000Z`), endDate: new Date('2026-11-15T00:00:00.000Z'), isCurrent: true, version: 1,
    }],
    mealPlanDay: [{
      id: 'ba5e0004-0000-4000-8000-000000000001', mealPlanId: 'ba5e0003-0000-4000-8000-000000000001',
      day: DayOfWeek.MONDAY, date: new Date(`${WEEK_A}T00:00:00.000Z`),
    }],
    plannedMeal: [{
      id: 'ba5e0005-0000-4000-8000-000000000001', dayId: 'ba5e0004-0000-4000-8000-000000000001',
      mealType: MealType.LUNCH, title: 'Pollo con Arroz', recipeId: RECETA_POLLO_ID, nutritionalValues: { calories: 400, protein: 35 },
    }],
  };
  for (const model of MODELS) if (rows[model]) fake.seed(model, rows[model]!);
  return Object.fromEntries(MODELS.map((model) => [model, (rows[model] ?? []).map((row) => fake.get(model, row.id)!)])) as Record<ModelName, Row[]>;
}

function expectNoSecrets(texts: string[]): void {
  for (const text of texts) {
    expect(text).not.toContain(DEMO_HASH);
    expect(text).not.toContain('://');
    expect(text).not.toMatch(/password/i);
  }
}

// ---------- tests ----------

describe('loadSynthetic — bulk load and idempotency (in-memory fake)', () => {
  it('loads every bulk table exactly; a second run adds 0 rows; never mutates; base data untouched', async () => {
    const fake = new FakeSeedDb();
    const base = seedBaseRows(fake);
    const dataset = datasetFor(WED);
    const logs: string[] = [];

    const first = await run(fake, WED, logs);
    expect(first.bulk).toMatchObject({ ok: true, counts: expectedBulk(dataset) });
    expect(first.bulk.counts).toEqual(expectedBulk(dataset));
    expect(bulkCountsIn(fake, dataset)).toEqual(expectedBulk(dataset));
    expect(first.currentWeek.ok).toBe(true);
    const afterFirst = fake.counts();

    const second = await run(fake, WED, logs);
    expect(fake.counts()).toEqual(afterFirst);
    expect(second.bulk).toMatchObject({ ok: true, counts: expectedBulk(dataset) });
    expect(second.bulk.counts).toEqual(expectedBulk(dataset));
    expect(second.currentWeek).toEqual(first.currentWeek);

    expect(fake.forbiddenCalls).toEqual([]);
    expect(fake.createManyCalls.length).toBeGreaterThan(0);
    for (const call of fake.createManyCalls) {
      expect(call.skipDuplicates).toBe(true);
      expect(call.size).toBeGreaterThanOrEqual(1);
      expect(call.size).toBeLessThanOrEqual(BATCH);
    }
    for (const model of MODELS) {
      for (const row of base[model]) expect(fake.get(model, row.id)).toEqual(row);
    }
    expectNoSecrets(logs);
  });

  it('writes bulk completions with snapshots of the PlannedMeal rows re-read from the DB', async () => {
    const fake = new FakeSeedDb();
    const dataset = datasetFor(WED);
    await run(fake, WED);

    const expectedById = new Map(dataset.completions.map((completion) => [completion.id, completion]));
    const stored = fake.rows('mealCompletion').filter((row) => expectedById.has(row.id));
    expect(stored).toHaveLength(dataset.completions.length);
    for (const row of stored) {
      const expected = expectedById.get(row.id)!;
      const meal = fake.get('plannedMeal', row.plannedMealId)!;
      expect({ userId: row.userId, plannedMealId: row.plannedMealId, status: row.status })
        .toEqual({ userId: expected.userId, plannedMealId: expected.plannedMealId, status: expected.status });
      expect(row.mealUpdatedAtSnapshot).toBeInstanceOf(Date);
      expect(mealCompletionSnapshotsMatch(row as never, meal as never)).toBe(true);
    }
  });

  it('a failure injected in the meals phase reports phase and batch; the next run completes the load', async () => {
    const fake = new FakeSeedDb();
    const dataset = datasetFor(WED);
    fake.failCreateMany('plannedMeal', { nth: 2 });

    const error = await rejectionOf(run(fake, WED));
    expect({ phase: error.phase, code: error.code, batch: error.batch }).toEqual({ phase: 'meals', code: 'batch_failed', batch: 2 });
    expect(error.message).toContain('meals');
    expect(error.message).toContain('2');
    expectNoSecrets([error.message]);
    expect(bulkCountsIn(fake, dataset).completions).toBe(0);
    expect(bulkCountsIn(fake, dataset).shoppingChecks).toBe(0);
    expect(fake.get('mealPlan', cwPlanId(WEEK_A))).toBeUndefined();

    const report = await run(fake, WED);
    expect(report.bulk.counts).toEqual(expectedBulk(dataset));
    expect(bulkCountsIn(fake, dataset)).toEqual(expectedBulk(dataset));
    expect(report.currentWeek.ok).toBe(true);
    expect(fake.forbiddenCalls).toEqual([]);
  });

  it('isolated conflict: only demo.seed.00001 exists with another id -> users fails with email_id_conflict, no dependents', async () => {
    const fake = new FakeSeedDb();
    const foreign = { id: FOREIGN_ID, email: syntheticEmail(1), name: 'Cuenta ajena', passwordHash: 'not-touched' };
    fake.seed('user', [foreign]);
    const before = fake.get('user', FOREIGN_ID);
    const logs: string[] = [];

    const error = await rejectionOf(run(fake, WED, logs));
    expect({ phase: error.phase, code: error.code }).toEqual({ phase: 'users', code: 'email_id_conflict' });
    expect(error.sample).toContain(syntheticEmail(1));
    expect(fake.get('user', FOREIGN_ID)).toEqual(before);
    const counts = fake.counts();
    expect({
      nutritionProfile: counts.nutritionProfile, recipe: counts.recipe, mealPlan: counts.mealPlan, mealPlanDay: counts.mealPlanDay,
      plannedMeal: counts.plannedMeal, mealCompletion: counts.mealCompletion, shoppingItemCheck: counts.shoppingItemCheck,
    }).toEqual({
      nutritionProfile: 0, recipe: 0, mealPlan: 0, mealPlanDay: 0, plannedMeal: 0, mealCompletion: 0, shoppingItemCheck: 0,
    });
    expect(fake.forbiddenCalls).toEqual([]);
    expect(logs.join('\n')).not.toMatch(/completad[oa] con [eé]xito|carga masiva OK/i);
  });

  it('a synthetic Ingredient.name existing with another id -> ingredients fails with key_id_conflict', async () => {
    const fake = new FakeSeedDb();
    const dataset = datasetFor(WED);
    const target = dataset.ingredients[0];
    fake.seed('ingredient', [{ ...target, id: FOREIGN_ID }]);

    const error = await rejectionOf(run(fake, WED));
    expect({ phase: error.phase, code: error.code }).toEqual({ phase: 'ingredients', code: 'key_id_conflict' });
    expect(fake.counts().user).toBe(0);
    expect(fake.get('ingredient', FOREIGN_ID)!.name).toBe(target.name);
  });

  it('a NutritionProfile.userId existing with another id -> profiles fails with key_id_conflict', async () => {
    const fake = new FakeSeedDb();
    const dataset = datasetFor(WED);
    fake.seed('user', [dataset.users[0]]);
    fake.seed('nutritionProfile', [{ ...dataset.profiles[0], id: FOREIGN_ID }]);

    const error = await rejectionOf(run(fake, WED));
    expect({ phase: error.phase, code: error.code }).toEqual({ phase: 'profiles', code: 'key_id_conflict' });
    expect(fake.counts().recipe).toBe(0);
    expect(fake.counts().mealPlan).toBe(0);
  });

  it('a read that fails during verification reports the phase as read_failed, without the original error text', async () => {
    const fake = new FakeSeedDb();
    const realFindMany = fake.client.mealPlanDay.findMany;
    let failed = false;
    fake.client.mealPlanDay.findMany = async (args?: unknown) => {
      if (!failed) {
        failed = true;
        throw new Error('connection lost postgresql://u_sentinel:p_sentinel@db/x');
      }
      return realFindMany(args);
    };

    const error = await rejectionOf(run(fake, WED));
    expect({ phase: error.phase, code: error.code }).toEqual({ phase: 'days', code: 'read_failed' });
    expect(error.message).toContain('days');
    expect(error.message).not.toContain('u_sentinel');
    expectNoSecrets([error.message]);
    expect(fake.counts().plannedMeal).toBe(0);

    const report = await run(fake, WED);
    expect(report.currentWeek.ok).toBe(true);
  });

  it('a row silently lost after createMany -> that phase reports missing_ids and stops', async () => {
    const fake = new FakeSeedDb();
    const dataset = datasetFor(WED);
    const lost = dataset.days[5].id;
    fake.dropOnInsert(lost);

    const error = await rejectionOf(run(fake, WED));
    expect({ phase: error.phase, code: error.code }).toEqual({ phase: 'days', code: 'missing_ids' });
    expect(error.sample).toContain(lost);
    expect(fake.counts().plannedMeal).toBe(0);
  });
});

describe('loadSynthetic — current week of 00001', () => {
  it('Monday -> 0 marks; Wednesday -> marks only Mon/Tue; Wednesday again -> +0; meal updatedAt never moves', async () => {
    const fake = new FakeSeedDb();

    const monday = await run(fake, MON);
    expect(monday.currentWeek).toEqual({
      ok: true,
      counts: expect.objectContaining({ plans: 1, days: 7, meals: 28, completions: 0 }),
    });
    const week1 = currentWeekRows(fake, WEEK_A);
    expect(week1.meals).toHaveLength(28);
    expect(week1.marks).toHaveLength(0);
    const updatedAt = new Map(week1.meals.map((meal) => [meal.id, meal.updatedAt.getTime()]));

    const wednesday = await run(fake, WED);
    const week2 = currentWeekRows(fake, WEEK_A);
    const oracle = buildCurrentWeekCompletions({
      now: WED, userId: DEMO_USER_ID, days: week2.days as never, meals: week2.meals as never,
    });
    expect(oracle.length).toBeGreaterThan(0);
    expect(week2.marks.map((mark) => ({ id: mark.id, plannedMealId: mark.plannedMealId, status: mark.status })).sort((a, b) => (a.id < b.id ? -1 : 1)))
      .toEqual(oracle.map((mark) => ({ id: mark.id, plannedMealId: mark.plannedMealId, status: mark.status })).sort((a, b) => (a.id < b.id ? -1 : 1)));
    const dayOfMeal = new Map(week2.meals.map((meal) => [meal.id, week2.days.find((day) => day.id === meal.dayId)!]));
    const markedDates = new Set(week2.marks.map((mark) => isoDay(dayOfMeal.get(mark.plannedMealId)!.date)));
    expect([...markedDates].sort()).toEqual(['2026-11-09', '2026-11-10']);
    for (const mark of week2.marks) {
      expect(isoDay(dayOfMeal.get(mark.plannedMealId)!.date) < '2026-11-11').toBe(true);
      const meal = week2.meals.find((m) => m.id === mark.plannedMealId)!;
      expect(mealCompletionSnapshotsMatch(mark as never, meal as never)).toBe(true);
    }
    expect(wednesday.currentWeek).toEqual({
      ok: true,
      counts: expect.objectContaining({ plans: 1, days: 7, meals: 28, completions: oracle.length }),
    });
    const afterWednesday = fake.counts();

    await run(fake, WED);
    expect(fake.counts()).toEqual(afterWednesday);
    const week3 = currentWeekRows(fake, WEEK_A);
    for (const meal of week3.meals) expect(meal.updatedAt.getTime()).toBe(updatedAt.get(meal.id));
    expect(week3.marks).toEqual(week2.marks);
    expect(fake.forbiddenCalls).toEqual([]);
  });

  it('week_current_conflict: bulk complete and verified, current week fails with the actionable message, nothing touched', async () => {
    const fake = new FakeSeedDb();
    const dataset = datasetFor(WED);
    fake.seed('user', [dataset.users[0]]);
    fake.seed('mealPlan', [{
      id: FOREIGN_ID, userId: DEMO_USER_ID, startDate: new Date(`${WEEK_A}T00:00:00.000Z`),
      endDate: new Date('2026-11-15T00:00:00.000Z'), isCurrent: true, version: 1,
    }]);
    fake.seed('mealPlanDay', [{
      id: 'f0e1d2c3-0000-4000-8000-0000000000bb', mealPlanId: FOREIGN_ID, day: DayOfWeek.MONDAY,
      date: new Date(`${WEEK_A}T00:00:00.000Z`),
    }]);
    fake.seed('plannedMeal', [MealType.BREAKFAST, MealType.LUNCH].map((mealType, i) => ({
      id: `f0e1d2c3-0000-4000-8000-0000000000c${i}`, dayId: 'f0e1d2c3-0000-4000-8000-0000000000bb',
      mealType, title: `Comida de la app ${i}`, recipeId: null, nutritionalValues: {},
    })));
    const foreignBefore = {
      plan: fake.get('mealPlan', FOREIGN_ID),
      days: fake.rows('mealPlanDay').filter((day) => day.mealPlanId === FOREIGN_ID),
      meals: fake.rows('plannedMeal').filter((meal) => meal.dayId === 'f0e1d2c3-0000-4000-8000-0000000000bb'),
    };

    const report = await run(fake, WED);

    expect(report.bulk).toMatchObject({ ok: true, counts: expectedBulk(dataset) });
    expect(report.bulk.counts).toEqual(expectedBulk(dataset));
    const bulk = bulkCountsIn(fake, dataset);
    expect(bulk).toEqual(expectedBulk(dataset));
    expect({ plans: bulk.plans, days: bulk.days, meals: bulk.meals })
      .toEqual({ plans: USERS, days: 7 * USERS, meals: 28 * USERS });
    expect(bulk.completions).toBe(dataset.completions.length);
    expect(bulk.shoppingChecks).toBe(dataset.shoppingChecks.length);

    expect(report.currentWeek.ok).toBe(false);
    const error = (report.currentWeek as { ok: false; error: SpecSeedPhaseError }).error;
    expect(error).toBeInstanceOf(SeedPhaseError);
    expect({ phase: error.phase, code: error.code }).toEqual({ phase: 'current-week:plan', code: 'week_current_conflict' });
    expect(error.message).toBe(ACTIONABLE(WEEK_A));

    expect({
      plan: fake.get('mealPlan', FOREIGN_ID),
      days: fake.rows('mealPlanDay').filter((day) => day.mealPlanId === FOREIGN_ID),
      meals: fake.rows('plannedMeal').filter((meal) => meal.dayId === 'f0e1d2c3-0000-4000-8000-0000000000bb'),
    }).toEqual(foreignBefore);
    for (const model of ['mealPlan', 'mealPlanDay', 'plannedMeal', 'mealCompletion', 'shoppingItemCheck'] as ModelName[]) {
      expect(fake.rows(model).filter((row) => row.id.startsWith('5eed') && isCurrentWeekId(row.id)).map((row) => row.id)).toEqual([]);
    }
    expect(fake.forbiddenCalls).toEqual([]);
  });
});

describe('loadSynthetic — phase ordering', () => {
  it('a failure injected in the current week does not undo or block the bulk load (no rejection)', async () => {
    const fake = new FakeSeedDb();
    const dataset = datasetFor(WED);
    fake.failCreateMany('mealPlanDay', { match: (rows) => rows.some((row) => isCurrentWeekId(row.id)) });

    const report = await run(fake, WED);

    expect(report.bulk).toMatchObject({ ok: true, counts: expectedBulk(dataset) });
    expect(report.bulk.counts).toEqual(expectedBulk(dataset));
    expect(bulkCountsIn(fake, dataset)).toEqual(expectedBulk(dataset));
    expect(report.currentWeek.ok).toBe(false);
    const error = (report.currentWeek as { ok: false; error: SpecSeedPhaseError }).error;
    expect(error).toBeInstanceOf(SeedPhaseError);
    expect({ phase: error.phase, code: error.code, batch: error.batch })
      .toEqual({ phase: 'current-week:days', code: 'batch_failed', batch: 1 });
    expect(fake.forbiddenCalls).toEqual([]);
  });

  it('a failure injected in the bulk load rejects and the current week is never executed', async () => {
    const fake = new FakeSeedDb();
    fake.failCreateMany('mealCompletion', { nth: 1 });

    const error = await rejectionOf(run(fake, WED));

    expect({ phase: error.phase, code: error.code, batch: error.batch }).toEqual({ phase: 'completions', code: 'batch_failed', batch: 1 });
    expect(fake.get('mealPlan', cwPlanId(WEEK_A))).toBeUndefined();
    expect(fake.createManyCalls.filter((call) => call.model === 'shoppingItemCheck')).toEqual([]);
    for (const model of MODELS) {
      expect(fake.rows(model).filter((row) => row.id.startsWith('5eed') && isCurrentWeekId(row.id))).toEqual([]);
    }
  });
});

describe('loadSynthetic — growth between weeks', () => {
  it('week A then week B grows exactly +1 plan, +7 days, +28 meals, +K checks, +marks; repeating B adds 0', async () => {
    const fake = new FakeSeedDb();
    const datasetB = datasetFor(NEXT_WED);

    await run(fake, WED);
    const a = fake.counts();
    await run(fake, NEXT_WED);
    const b = fake.counts();

    const generated = shoppingPlanFromGenerator(datasetB, NEXT_WED);
    expect(generated.monday).toBe(WEEK_B);
    const K = buildCurrentWeekShoppingChecks({ monday: WEEK_B, userId: DEMO_USER_ID, plan: generated.plan }).length;
    expect(K).toBeGreaterThan(0);
    const weekB = buildCurrentWeek({ now: NEXT_WED, dataset: datasetB });
    const M = buildCurrentWeekCompletions({
      now: NEXT_WED, userId: DEMO_USER_ID, days: weekB.days,
      meals: weekB.meals.map((meal) => ({ ...meal, updatedAt: new Date(0) })),
    }).length;
    expect(M).toBeGreaterThan(0);

    const delta = Object.fromEntries(MODELS.map((model) => [model, b[model] - a[model]]));
    expect(delta).toEqual({
      user: 0, nutritionProfile: 0, ingredient: 0, recipe: 0,
      mealPlan: 1, mealPlanDay: 7, plannedMeal: 28, mealCompletion: M, shoppingItemCheck: K,
    });
    expect(fake.get('mealPlan', cwPlanId(WEEK_A))).toBeDefined();
    expect(fake.get('mealPlan', cwPlanId(WEEK_B))).toBeDefined();

    await run(fake, NEXT_WED);
    expect(fake.counts()).toEqual(b);
  });

  it('current-week checks: every itemKey comes from transformShoppingList of the 00001 current plan; mixed; no duplicates', async () => {
    const fake = new FakeSeedDb();
    const report = await run(fake, WED);

    const planId = cwPlanId(WEEK_A);
    const expectedKeys = transformShoppingList(WEEK_A, shoppingPlanFromFake(fake, planId)).items.map((item) => item.key);
    expect(expectedKeys.length).toBeGreaterThan(1);
    const checks = currentWeekRows(fake, WEEK_A).checks;
    expect(checks.map((check) => check.itemKey).sort()).toEqual([...expectedKeys].sort());
    expect(new Set(checks.map((check) => check.itemKey)).size).toBe(checks.length);
    expect(new Set(checks.map((check) => check.checked))).toEqual(new Set([true, false]));
    for (const check of checks) {
      expect(check.userId).toBe(DEMO_USER_ID);
      expect(check.id).toMatch(new RegExp(`^5eed0009-0000-4000-8000-9${WEEK_A.replace(/-/g, '')}\\d{3}$`));
    }
    expect(report.currentWeek).toEqual({
      ok: true,
      counts: expect.objectContaining({ shoppingChecks: expectedKeys.length }),
    });

    await run(fake, WED);
    const again = currentWeekRows(fake, WEEK_A).checks;
    expect(again).toEqual(checks);
  });
});
