// NUT-114 — Carga por fases del dataset sintético.
// Escribe solo con createMany({ skipDuplicates: true }) y verifica cada fase leyendo la base: skipDuplicates no avisa
// conflictos, así que cada fase comprueba primero que las claves únicas apunten al id esperado y después que existan
// todos los ids. Nunca actualiza ni borra filas. La semana actual de 00001 es una fase aparte: si falla, la carga masiva
// ya quedó completa y verificada y el reporte lo indica sin rechazar.
import type { ShoppingListPlan } from '../../src/modules/shopping-list/shopping-list.types';
import {
  SyntheticDataset,
  buildCurrentWeek,
  buildCurrentWeekCompletions,
  buildCurrentWeekShoppingChecks,
} from './generate';

export type SeedPhase =
  | 'ingredients' | 'users' | 'profiles' | 'recipes' | 'plans' | 'days' | 'meals' | 'completions'
  | 'shopping-checks' | 'verify-bulk'
  | 'current-week:plan' | 'current-week:days' | 'current-week:meals' | 'current-week:completions'
  | 'current-week:shopping-checks' | 'verify-current-week';

export type SeedPhaseErrorCode =
  | 'batch_failed'
  | 'missing_ids'
  | 'email_id_conflict'
  | 'key_id_conflict'
  | 'week_current_conflict'
  | 'verify_failed'
  | 'read_failed';

const DEFAULT_MESSAGES: Record<SeedPhaseErrorCode, string> = {
  batch_failed: 'falló la escritura',
  read_failed: 'falló una lectura de verificación',
  missing_ids: 'faltan filas esperadas después de escribir',
  email_id_conflict: 'hay emails sintéticos que ya existen con otro id',
  key_id_conflict: 'hay claves únicas que ya existen con otro id',
  week_current_conflict: 'ya existe un plan actual con otro id para la semana',
  verify_failed: 'la verificación no coincide con lo esperado',
};

export class SeedPhaseError extends Error {
  readonly phase: SeedPhase;
  readonly code: SeedPhaseErrorCode;
  readonly batch?: number;
  readonly sample?: string[];

  constructor(phase: SeedPhase, code: SeedPhaseErrorCode, opts: { batch?: number; sample?: string[]; message?: string } = {}) {
    const batchText = opts.batch === undefined ? '' : ` (lote ${opts.batch})`;
    super(opts.message ?? `Fase ${phase}${batchText}: ${DEFAULT_MESSAGES[code]}. Reejecutar el seed retoma la carga.`);
    this.name = 'SeedPhaseError';
    this.phase = phase;
    this.code = code;
    if (opts.batch !== undefined) this.batch = opts.batch;
    if (opts.sample !== undefined) this.sample = opts.sample;
  }
}

export type SeedTableKey =
  'ingredients' | 'users' | 'profiles' | 'recipes' | 'plans' | 'days' | 'meals' | 'completions' | 'shoppingChecks';

export interface CurrentWeekCounts { plans: 1; days: 7; meals: 28; completions: number; shoppingChecks: number }

export interface LoadReport {
  bulk: { ok: true; counts: Record<SeedTableKey, number> };
  currentWeek: { ok: true; counts: CurrentWeekCounts } | { ok: false; error: SeedPhaseError };
}

type Row = Record<string, any>;
interface Delegate {
  createMany(args: { data: Row[]; skipDuplicates: true }): Promise<unknown>;
  findMany(args: { where?: Row; select?: Row; orderBy?: Row }): Promise<Row[]>;
  findFirst(args: { where?: Row; select?: Row }): Promise<Row | null>;
  count(args: { where?: Row }): Promise<number>;
}
/** Subconjunto de PrismaClient que usa el loader (un PrismaClient real lo cumple). */
export interface SyntheticSeedClient {
  user: Delegate;
  nutritionProfile: Delegate;
  ingredient: Delegate;
  recipe: Delegate;
  mealPlan: Delegate;
  mealPlanDay: Delegate;
  plannedMeal: Delegate;
  mealCompletion: Delegate;
  shoppingItemCheck: Delegate;
}

export interface LoadOptions {
  dataset: SyntheticDataset;
  now: Date;
  batchSize: number;
  log?: (line: string) => void;
}

const SAMPLE_SIZE = 5;
const DEMO_EMAIL = 'demo.seed.00001';

function chunks<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

const keyOf = (row: Row, fields: readonly string[]) =>
  fields.map((field) => (row[field] instanceof Date ? row[field].toISOString() : String(row[field]))).join('|');

class Loader {
  /** Fase en curso: un error inesperado (p. ej. una lectura que falla) se informa con esta fase. */
  currentPhase: SeedPhase = 'ingredients';

  constructor(private readonly client: SyntheticSeedClient, private readonly opts: LoadOptions) {}

  private log(line: string): void {
    this.opts.log?.(line);
  }

  /** Escribe en lotes; un lote que falla corta la fase con el número de lote (base 1). */
  async write(phase: SeedPhase, delegate: Delegate, rows: readonly Row[]): Promise<void> {
    this.currentPhase = phase;
    const batches = chunks(rows, this.opts.batchSize);
    for (let i = 0; i < batches.length; i += 1) {
      try {
        await delegate.createMany({ data: batches[i], skipDuplicates: true });
      } catch {
        throw new SeedPhaseError(phase, 'batch_failed', { batch: i + 1 });
      }
    }
  }

  /** Lee por lotes de valores `in` para no exceder el límite de parámetros. */
  async readIn(delegate: Delegate, field: string, values: readonly unknown[], select: Row, extra: Row = {}): Promise<Row[]> {
    const unique = [...new Set(values)];
    const out: Row[] = [];
    for (const part of chunks(unique, this.opts.batchSize)) {
      out.push(...await delegate.findMany({ where: { ...extra, [field]: { in: part } }, select }));
    }
    return out;
  }

  /** Clave única → id esperado. `lookupField` acota la lectura (un campo de la clave con `in`). */
  async checkKeys(
    phase: SeedPhase,
    delegate: Delegate,
    rows: readonly Row[],
    fields: readonly string[],
    lookupField: string,
    code: 'email_id_conflict' | 'key_id_conflict' = 'key_id_conflict',
  ): Promise<void> {
    const expected = new Map(rows.map((row) => [keyOf(row, fields), row.id as string]));
    const select = Object.fromEntries(['id', ...fields].map((field) => [field, true]));
    const found = await this.readIn(delegate, lookupField, rows.map((row) => row[lookupField]), select);
    const conflicts = found
      .filter((row) => expected.has(keyOf(row, fields)) && expected.get(keyOf(row, fields)) !== row.id)
      .map((row) => keyOf(row, fields));
    if (conflicts.length > 0) throw new SeedPhaseError(phase, code, { sample: conflicts.slice(0, SAMPLE_SIZE) });
  }

  async checkIds(phase: SeedPhase, delegate: Delegate, rows: readonly Row[]): Promise<number> {
    const ids = rows.map((row) => row.id as string);
    const present = new Set((await this.readIn(delegate, 'id', ids, { id: true })).map((row) => row.id as string));
    const missing = ids.filter((id) => !present.has(id));
    if (missing.length > 0) throw new SeedPhaseError(phase, 'missing_ids', { sample: missing.slice(0, SAMPLE_SIZE) });
    return ids.length;
  }

  async phase(
    phase: SeedPhase,
    delegate: Delegate,
    rows: readonly Row[],
    keys: Array<{ fields: string[]; lookup: string; code?: 'email_id_conflict' | 'key_id_conflict' }> = [],
  ): Promise<number> {
    this.currentPhase = phase;
    if (rows.length > 0) await this.write(phase, delegate, rows);
    for (const key of keys) await this.checkKeys(phase, delegate, rows, key.fields, key.lookup, key.code);
    const count = await this.checkIds(phase, delegate, rows);
    this.log(`fase ${phase}: ${count} filas verificadas`);
    return count;
  }

  /** Re-lee las comidas para tomar recipeId/updatedAt reales como snapshot de las marcas. */
  async mealsById(ids: readonly string[]): Promise<Map<string, Row>> {
    const rows = await this.readIn(this.client.plannedMeal, 'id', ids, { id: true, dayId: true, recipeId: true, updatedAt: true });
    return new Map(rows.map((row) => [row.id as string, row]));
  }

  async bulk(): Promise<Record<SeedTableKey, number>> {
    const { client } = this;
    const d = this.opts.dataset;
    const counts = {} as Record<SeedTableKey, number>;

    counts.ingredients = await this.phase('ingredients', client.ingredient, d.ingredients, [{ fields: ['name'], lookup: 'name' }]);
    counts.users = await this.phase('users', client.user, d.users, [{ fields: ['email'], lookup: 'email', code: 'email_id_conflict' }]);
    counts.profiles = await this.phase('profiles', client.nutritionProfile, d.profiles, [{ fields: ['userId'], lookup: 'userId' }]);
    counts.recipes = await this.phase('recipes', client.recipe, d.recipes);
    counts.plans = await this.phase('plans', client.mealPlan, d.plans);
    counts.days = await this.phase('days', client.mealPlanDay, d.days, [{ fields: ['mealPlanId', 'day'], lookup: 'mealPlanId' }]);
    counts.meals = await this.phase('meals', client.plannedMeal, d.meals);

    const meals = await this.mealsById(d.completions.map((completion) => completion.plannedMealId));
    const completions = d.completions.map((completion) => {
      const meal = meals.get(completion.plannedMealId);
      if (!meal) throw new SeedPhaseError('completions', 'missing_ids', { sample: [completion.plannedMealId] });
      return { ...completion, recipeIdSnapshot: meal.recipeId, mealUpdatedAtSnapshot: meal.updatedAt };
    });
    counts.completions = await this.phase('completions', client.mealCompletion, completions, [{ fields: ['plannedMealId'], lookup: 'plannedMealId' }]);
    counts.shoppingChecks = await this.phase('shopping-checks', client.shoppingItemCheck, d.shoppingChecks, [
      { fields: ['userId', 'planId', 'itemKey'], lookup: 'planId' },
    ]);

    await this.verifyPlans('verify-bulk', d.plans.map((plan) => plan.id));
    this.log('fase verify-bulk: planes 7x4 completos');
    return counts;
  }

  /** Cada plan tiene 7 días y cada día 4 comidas. */
  async verifyPlans(phase: SeedPhase, planIds: readonly string[]): Promise<void> {
    this.currentPhase = phase;
    const days = await this.readIn(this.client.mealPlanDay, 'mealPlanId', planIds, { id: true, mealPlanId: true });
    const daysPerPlan = new Map<string, number>();
    for (const day of days) daysPerPlan.set(day.mealPlanId, (daysPerPlan.get(day.mealPlanId) ?? 0) + 1);
    const badPlans = planIds.filter((id) => daysPerPlan.get(id) !== 7);
    const meals = await this.readIn(this.client.plannedMeal, 'dayId', days.map((day) => day.id), { dayId: true });
    const mealsPerDay = new Map<string, number>();
    for (const meal of meals) mealsPerDay.set(meal.dayId, (mealsPerDay.get(meal.dayId) ?? 0) + 1);
    const badDays = days.filter((day) => mealsPerDay.get(day.id) !== 4).map((day) => day.id as string);
    if (badPlans.length > 0 || badDays.length > 0) {
      throw new SeedPhaseError(phase, 'verify_failed', { sample: [...badPlans, ...badDays].slice(0, SAMPLE_SIZE) });
    }
  }

  async currentWeek(): Promise<CurrentWeekCounts> {
    const { client } = this;
    const { dataset, now } = this.opts;
    this.currentPhase = 'current-week:plan';
    const week = buildCurrentWeek({ now, dataset });
    const userId = week.plan.userId;

    const conflict = async () => {
      const current = await client.mealPlan.findFirst({
        where: { userId, startDate: week.plan.startDate, isCurrent: true },
        select: { id: true },
      });
      if (current && current.id !== week.plan.id) {
        throw new SeedPhaseError('current-week:plan', 'week_current_conflict', {
          message: `current-week: ${DEMO_EMAIL} ya tiene un plan actual creado fuera del seed para la semana ${week.monday}. `
            + 'La carga masiva quedó completa y verificada. Para el recorrido, usá ese plan o corré el seed en otra base. '
            + 'No se borró ni modificó ningún dato.',
        });
      }
    };
    await conflict();
    await this.write('current-week:plan', client.mealPlan, [week.plan]);
    await conflict();
    await this.checkIds('current-week:plan', client.mealPlan, [week.plan]);

    await this.phase('current-week:days', client.mealPlanDay, week.days, [{ fields: ['mealPlanId', 'day'], lookup: 'mealPlanId' }]);
    await this.phase('current-week:meals', client.plannedMeal, week.meals);

    // Re-lectura: días por fecha (lunes primero) y comidas por id (orden B/L/S/D dentro del día).
    const days = (await client.mealPlanDay.findMany({ where: { mealPlanId: week.plan.id }, select: { id: true, date: true } }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const meals = [...(await this.mealsById(week.meals.map((meal) => meal.id))).values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const marks = buildCurrentWeekCompletions({
      now,
      userId,
      days: days.map((day) => ({ id: day.id as string, date: day.date as Date })),
      meals: meals.map((meal) => ({
        id: meal.id as string, dayId: meal.dayId as string, recipeId: meal.recipeId as string | null, updatedAt: meal.updatedAt as Date,
      })),
    });
    await this.phase('current-week:completions', client.mealCompletion, marks, [{ fields: ['plannedMealId'], lookup: 'plannedMealId' }]);

    const plan = await client.mealPlan.findFirst({ where: { id: week.plan.id }, select: { id: true, version: true, updatedAt: true } });
    if (!plan) throw new SeedPhaseError('current-week:shopping-checks', 'missing_ids', { sample: [week.plan.id] });
    const recipes = await this.readIn(client.recipe, 'id', meals.map((meal) => meal.recipeId), { id: true, ingredients: true });
    const recipeById = new Map(recipes.map((recipe) => [recipe.id as string, recipe]));
    const shoppingPlan: NonNullable<ShoppingListPlan> = {
      id: plan.id,
      version: plan.version,
      updatedAt: plan.updatedAt,
      days: days.map((day) => ({
        meals: meals.filter((meal) => meal.dayId === day.id).map((meal) => {
          const recipe = recipeById.get(meal.recipeId);
          return { id: meal.id, recipeId: meal.recipeId, recipe: recipe ? { id: recipe.id, ingredients: recipe.ingredients } : null };
        }),
      })),
    };
    const checks = buildCurrentWeekShoppingChecks({ monday: week.monday, userId, plan: shoppingPlan });
    await this.phase('current-week:shopping-checks', client.shoppingItemCheck, checks, [
      { fields: ['userId', 'planId', 'itemKey'], lookup: 'planId' },
    ]);

    await this.verifyPlans('verify-current-week', [week.plan.id]);
    const completions = await client.mealCompletion.count({ where: { plannedMealId: { in: meals.map((meal) => meal.id) } } });
    const shoppingChecks = await client.shoppingItemCheck.count({ where: { planId: week.plan.id } });
    this.log(`fase verify-current-week: semana ${week.monday}, ${completions} marcas, ${shoppingChecks} ítems de compra`);
    return { plans: 1, days: 7, meals: 28, completions, shoppingChecks };
  }
}

/** Un error que no es de fase (lectura caída, etc.) se informa con la fase en curso, sin su texto original. */
const asPhaseError = (error: unknown, loader: Loader): SeedPhaseError =>
  error instanceof SeedPhaseError ? error : new SeedPhaseError(loader.currentPhase, 'read_failed');

export async function loadSynthetic(client: SyntheticSeedClient, opts: LoadOptions): Promise<LoadReport> {
  const loader = new Loader(client, opts);
  let counts: Record<SeedTableKey, number>;
  try {
    counts = await loader.bulk();
  } catch (error) {
    throw asPhaseError(error, loader);
  }
  try {
    return { bulk: { ok: true, counts }, currentWeek: { ok: true, counts: await loader.currentWeek() } };
  } catch (error) {
    return { bulk: { ok: true, counts }, currentWeek: { ok: false, error: asPhaseError(error, loader) } };
  }
}
