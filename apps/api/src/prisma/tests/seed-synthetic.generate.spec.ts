/**
 * NUT-114 — Pure synthetic generator (Block 1, TDD red first).
 *
 * Expected API of `apps/api/prisma/synthetic/catalog.ts`:
 *
 *   export interface CuratedIngredient {
 *     name: string;
 *     type: IngredientType;
 *     defaultUnit: 'g' | 'ml' | 'unidad';
 *     nutritionalValues: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
 *     // plus whatever diet / allergen tags the implementer needs
 *   }
 *   export const CURATED_INGREDIENTS: readonly CuratedIngredient[];   // ~60 real ingredients
 *
 * Expected API of `apps/api/prisma/synthetic/generate.ts` (pure, deterministic, `now` injected, no env, no I/O):
 *
 *   export const SYNTHETIC_GENERATOR_SENTINEL: string;                 // text searched for in dist/ (must not appear)
 *   export const SYNTHETIC_NO_LOGIN_HASH = '!synthetic-no-login';
 *   export const PAST_PLAN_FIRST_MONDAY = '2026-01-05';
 *   export const PAST_PLAN_WEEKS = 40;
 *
 *   export type SyntheticGenerationErrorCode =
 *     'invalid_volume' | 'invalid_demo_hash' | 'ingredient_name_collision' | 'now_before_past_weeks';
 *   export class SyntheticGenerationError extends Error { readonly code: SyntheticGenerationErrorCode }
 *
 *   // NFKC -> NFD strip diacritics -> lowercase -> trim -> collapse whitespace
 *   export function normalizeIngredientName(name: string): string;
 *
 *   // Builds `count` synthetic ingredients: the catalog first, then deterministic combinatorial names.
 *   // Throws SyntheticGenerationError('ingredient_name_collision') when any name (catalog or generated) collides under
 *   // normalizeIngredientName with another one or with PECHUGA_POLLO_SEED.name / ARROZ_INTEGRAL_SEED.name
 *   // (imported from src/prisma/seed-data, not copied).
 *   export function buildIngredients(opts: { count: number; catalog?: readonly CuratedIngredient[] }): SyntheticIngredient[];
 *
 *   export interface GenerateOptions {
 *     users: number;               // integer 1..5000, everything else scales from it; otherwise 'invalid_volume'
 *     demoPasswordHash: string;    // precomputed bcrypt hash for user 00001; non-bcrypt string -> 'invalid_demo_hash'
 *     now: Date;                   // the last past-plan week (Monday 2026-10-05, ends Sunday 2026-10-11) must be
 *                                  // strictly before BA today,
 *                                  // otherwise 'now_before_past_weeks'
 *     catalog?: readonly CuratedIngredient[];   // defaults to CURATED_INGREDIENTS
 *   }
 *   export function generateSyntheticDataset(opts: GenerateOptions): SyntheticDataset;
 *
 *   export interface SyntheticDataset {
 *     ingredients: Array<{ id; name; type: IngredientType; description: string; defaultUnit: string;
 *                          nutritionalValues: { calories; protein; carbs; fat; fiber }; properties: string[] }>;   // users
 *     users: Array<{ id; email; name; passwordHash }>;                       // exactly these keys; users[i] is n = i+1
 *     profiles: Array<{ id; userId; goal: NutritionGoal; diet: Diet; excludedIngredients: DietaryRestriction[];
 *                       cookTimePreference: CookTimePreference }>;            // 1:1 with users
 *     recipes: Array<{ id; title; description: string; prepMinutes: number; cookMinutes: number;
 *                      categories: RecipeCategory[]; ingredients: Array<{ name: string; quantity: number; unit: string }>;
 *                      instructions: string[]; nutritionalValues: { calories; protein; fiber; carbs; fat };  // per serving
 *                      properties: string[]; origin: 'MANUAL'; createdAt: Date }>;   // NO `image` key
 *     plans: Array<{ id; userId; startDate: Date; endDate: Date; isCurrent: true; version: 1 }>;   // one past plan per user
 *     days: Array<{ id; mealPlanId; day: DayOfWeek; date: Date }>;           // per plan, Monday..Sunday, in order
 *     meals: Array<{ id; dayId; mealType: MealType; title: string; recipeId: string;
 *                    nutritionalValues: ReturnType<typeof mapRecipeNutritionToMeal> }>;   // per day, B/L/S/D, in order
 *     completions: Array<{ id; userId; plannedMealId; recipeIdSnapshot: string; status: MealCompletionStatus }>;
 *                    // ceil(users/20) active users x 20 marks (14 COMPLETED, 4 SKIPPED, 2 NOT_LOGGED) on past plans
 *     shoppingChecks: Array<{ id; userId; planId; itemKey: string; checked: boolean }>;   // one per past plan
 *   }
 *
 *   // Current week of the walkthrough account 00001 (all pure):
 *   export function currentWeekMonday(now: Date): string;   // 'YYYY-MM-DD' Monday of the Buenos Aires civil week
 *   export function buildCurrentWeek(opts: { now: Date; dataset: SyntheticDataset }): {
 *     monday: string;
 *     plan: { id; userId; startDate: Date; endDate: Date; isCurrent: true; version: 1 };   // id …-9YYYYMMDD000
 *     days: SyntheticDataset['days'];      // ids …-9YYYYMMDD00D (D = 0..6)
 *     meals: SyntheticDataset['meals'];    // ids …-9YYYYMMDD0DM (M = 0..3); only recipes built from CURATED_INGREDIENTS
 *   };
 *   // `meals` are the rows re-read from the DB (updatedAt set by Prisma). Marks only for days strictly before BA today,
 *   // fixed per-day pattern independent of `now` (every day: 1..3 rows + at least one meal without row; across Mon+Tue
 *   // all of COMPLETED, SKIPPED, NOT_LOGGED appear); ids 5eed0008-…-9YYYYMMDD0DM matching the meal.
 *   export function buildCurrentWeekCompletions(opts: {
 *     now: Date; userId: string; days: Array<{ id: string; date: Date }>;
 *     meals: Array<{ id: string; dayId: string; recipeId: string | null; updatedAt: Date }>;
 *   }): Array<{ id; userId; plannedMealId; recipeIdSnapshot: string | null; mealUpdatedAtSnapshot: Date; status }>;
 *   // One check per transformShoppingList(monday, plan) item, alternating checked, ids 5eed0009-…-9YYYYMMDDIII.
 *   export function buildCurrentWeekShoppingChecks(opts: {
 *     monday: string; userId: string; plan: NonNullable<ShoppingListPlan>;
 *   }): Array<{ id; userId; planId; itemKey: string; checked: boolean }>;
 */
import {
  CookTimePreference,
  DayOfWeek,
  Diet,
  DietaryRestriction,
  IngredientType,
  MealCompletionStatus,
  MealType,
  NutritionGoal,
  RecipeCategory,
} from '@/generated/prisma/client';
import { buildWeeklySlots } from '@/modules/plans/weekly-proposal-assignment';
import { mapRecipeNutritionToMeal } from '@/modules/plans/recipe-nutrition.mapper';
import { transformShoppingList } from '@/modules/shopping-list/shopping-list.transform';
import {
  findExcludedIngredientInSource,
  profileForbiddenRestrictions,
} from '@/modules/recipe/validation/ingredient-dictionary';
import { RECIPE_VALIDATION_CONFIG } from '@/modules/recipe/validation/recipe-validation.config';
import { dateInBuenosAires } from '@/modules/adherence/adherence.repository';
import {
  ARROZ_INTEGRAL_SEED,
  PECHUGA_POLLO_SEED,
  RECETA_POLLO_ID,
  syntheticEmail,
  syntheticName,
} from '../seed-data';
import { CURATED_INGREDIENTS } from '../../../prisma/synthetic/catalog';
import {
  PAST_PLAN_FIRST_MONDAY,
  PAST_PLAN_WEEKS,
  SYNTHETIC_GENERATOR_SENTINEL,
  SyntheticGenerationError,
  buildCurrentWeek,
  buildCurrentWeekCompletions,
  buildCurrentWeekShoppingChecks,
  buildIngredients,
  currentWeekMonday,
  generateSyntheticDataset,
  normalizeIngredientName,
} from '../../../prisma/synthetic/generate';

// ---------- fixtures & independent helpers ----------

const NOW = new Date('2026-11-11T15:00:00.000Z'); // Wednesday 12:00 in Buenos Aires
// Real bcrypt hash (cost 4) of 'demo-walkthrough-pass'; the generator only stores it. See credentials spec.
const DEMO_HASH = '$2b$04$QL597mIXc6JauPDhUTUPR.uUjvBlSb9NxRWu5xn4egJ78KrMILTNK';
const SYNTH_ID = /^5eed\d{4}-0000-4000-8000-\d{12}$/;
const VALID_UNITS = new Set(['g', 'kg', 'ml', 'l', 'unidad']);
const DAY_MS = 24 * 60 * 60 * 1000;
const MEAL_TYPES = [MealType.BREAKFAST, MealType.LUNCH, MealType.SNACK, MealType.DINNER];

/** Independent oracle for the strict normalization agreed in design §7.4. */
function strictNormalize(value: string): string {
  return value
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function hasWord(text: string, words: readonly string[]): string | null {
  const normalized = strictNormalize(text);
  return words.find((word) => new RegExp(`\\b${word}(s|es)?\\b`).test(normalized)) ?? null;
}

const GRAIN_WORDS = ['arroz', 'avena', 'quinoa', 'maiz', 'trigo', 'cebada', 'centeno', 'mijo', 'amaranto'];
const SUGAR_WORDS = ['azucar', 'almibar', 'jarabe', 'dulce de leche', 'mermelada', 'caramelo'];
const KETO_SUGAR_WORDS = [...SUGAR_WORDS, 'miel'];
const SWEET_FRUIT_WORDS = [
  'banana', 'platano', 'mango', 'uva', 'datil', 'higo', 'pasa', 'anana', 'pina', 'manzana', 'pera',
  'durazno', 'ciruela', 'sandia', 'melon',
];
const LEGUME_WORDS = [
  'lenteja', 'garbanzo', 'poroto', 'frijol', 'alubia', 'arveja', 'haba', 'soja', 'soya', 'tofu', 'tempeh',
  'edamame', 'mani', 'cacahuate', 'hummus',
];

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const lastSegment = (id: string) => id.slice(-12);
const tableCode = (id: string) => id.slice(4, 8);

// Expected shapes, declared here (from the API contract in the header) so this spec type-checks on its own
// and does not depend on inference from the module under test.
type NutritionValues = { calories: number; protein: number; carbs: number; fat: number; fiber: number };
interface SpecCuratedIngredient {
  name: string;
  type: IngredientType;
  defaultUnit: string;
  nutritionalValues: NutritionValues;
}
interface SpecIngredient extends SpecCuratedIngredient {
  id: string;
  description: string;
  properties: string[];
}
interface SpecUser { id: string; email: string; name: string; passwordHash: string }
interface SpecProfile {
  id: string;
  userId: string;
  goal: NutritionGoal;
  diet: Diet;
  excludedIngredients: DietaryRestriction[];
  cookTimePreference: CookTimePreference;
}
interface SpecRecipe {
  id: string;
  title: string;
  description: string;
  prepMinutes: number;
  cookMinutes: number;
  categories: RecipeCategory[];
  ingredients: Array<{ name: string; quantity: number; unit: string }>;
  instructions: string[];
  nutritionalValues: NutritionValues;
  properties: string[];
  origin: 'MANUAL';
  createdAt: Date;
}
interface SpecPlan { id: string; userId: string; startDate: Date; endDate: Date; isCurrent: true; version: 1 }
interface SpecDay { id: string; mealPlanId: string; day: DayOfWeek; date: Date }
interface SpecMeal {
  id: string;
  dayId: string;
  mealType: MealType;
  title: string;
  recipeId: string;
  nutritionalValues: ReturnType<typeof mapRecipeNutritionToMeal>;
}
interface SpecCompletion {
  id: string;
  userId: string;
  plannedMealId: string;
  recipeIdSnapshot: string | null;
  status: MealCompletionStatus;
}
interface SpecCurrentWeekMark extends SpecCompletion { mealUpdatedAtSnapshot: Date }
interface SpecShoppingCheck { id: string; userId: string; planId: string; itemKey: string; checked: boolean }
interface SpecDataset {
  ingredients: SpecIngredient[];
  users: SpecUser[];
  profiles: SpecProfile[];
  recipes: SpecRecipe[];
  plans: SpecPlan[];
  days: SpecDay[];
  meals: SpecMeal[];
  completions: SpecCompletion[];
  shoppingChecks: SpecShoppingCheck[];
}
interface SpecCurrentWeek { monday: string; plan: SpecPlan; days: SpecDay[]; meals: SpecMeal[] }
type SpecGenerateOverrides = Partial<{ demoPasswordHash: string; now: Date; catalog: readonly SpecCuratedIngredient[] }>;

const CATALOG = CURATED_INGREDIENTS as readonly SpecCuratedIngredient[];
const ingredientsOf = (opts: { count: number; catalog?: readonly SpecCuratedIngredient[] }) =>
  buildIngredients(opts) as SpecIngredient[];
const currentWeekOf = (now: Date, dataset: SpecDataset) =>
  buildCurrentWeek({ now, dataset }) as SpecCurrentWeek;

type Dataset = SpecDataset;
type Recipe = SpecRecipe;
type Meal = SpecMeal;
type Day = SpecDay;

function indexDataset(dataset: Dataset) {
  const recipesById = new Map(dataset.recipes.map((r) => [r.id, r]));
  const ingredientsByName = new Map(dataset.ingredients.map((i) => [i.name, i]));
  const profileByUser = new Map(dataset.profiles.map((p) => [p.userId, p]));
  const planById = new Map(dataset.plans.map((p) => [p.id, p]));
  const dayById = new Map(dataset.days.map((d) => [d.id, d]));
  const mealById = new Map(dataset.meals.map((m) => [m.id, m]));
  const daysByPlan = new Map<string, Day[]>();
  for (const day of dataset.days) {
    const list = daysByPlan.get(day.mealPlanId) ?? [];
    list.push(day);
    daysByPlan.set(day.mealPlanId, list);
  }
  const mealsByDay = new Map<string, Meal[]>();
  for (const meal of dataset.meals) {
    const list = mealsByDay.get(meal.dayId) ?? [];
    list.push(meal);
    mealsByDay.set(meal.dayId, list);
  }
  const mealsOfPlan = (planId: string): Meal[] =>
    (daysByPlan.get(planId) ?? []).flatMap((day) => mealsByDay.get(day.id) ?? []);
  return { recipesById, ingredientsByName, profileByUser, planById, dayById, mealById, daysByPlan, mealsByDay, mealsOfPlan };
}

function shoppingPlanFor(
  plan: { id: string },
  days: Day[],
  mealsByDay: Map<string, Meal[]> | ((dayId: string) => Meal[]),
  recipesById: Map<string, Recipe>,
) {
  const mealsOf = typeof mealsByDay === 'function' ? mealsByDay : (dayId: string) => mealsByDay.get(dayId) ?? [];
  return {
    id: plan.id,
    version: 1,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    days: days.map((day) => ({
      meals: mealsOf(day.id).map((meal) => {
        const recipe = recipesById.get(meal.recipeId)!;
        return { id: meal.id, recipeId: meal.recipeId, recipe: { id: recipe.id, ingredients: recipe.ingredients } };
      }),
    })),
  };
}

function generate(users: number, overrides: SpecGenerateOverrides = {}): SpecDataset {
  return generateSyntheticDataset({ users, demoPasswordHash: DEMO_HASH, now: NOW, ...overrides }) as SpecDataset;
}

function expectGenerationError(fn: () => unknown, code: string) {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SyntheticGenerationError);
  expect((caught as { code: string }).code).toBe(code);
}

// ---------- tests ----------

describe('synthetic generator — basics', () => {
  it('exports a sentinel string for the dist/ check', () => {
    expect(typeof SYNTHETIC_GENERATOR_SENTINEL).toBe('string');
    expect(SYNTHETIC_GENERATOR_SENTINEL.length).toBeGreaterThan(8);
  });

  it('is deterministic: same options produce deep-equal datasets', () => {
    expect(generate(30)).toEqual(generate(30));
  });

  it.each([0, 5001, 1.5, -3])('rejects users=%p with invalid_volume', (users) => {
    expectGenerationError(() => generate(users), 'invalid_volume');
  });

  it('rejects a demo password hash that is not bcrypt (never store plaintext)', () => {
    expectGenerationError(() => generate(5, { demoPasswordHash: 'plain-password' }), 'invalid_demo_hash');
  });

  it('rejects a `now` that is not after every past-plan week (marks would be in the future)', () => {
    expectGenerationError(() => generate(5, { now: new Date('2026-06-01T12:00:00.000Z') }), 'now_before_past_weeks');
  });

  it('scales every quota table from `users`', () => {
    const d = generate(50);
    expect(d.users).toHaveLength(50);
    expect(d.profiles).toHaveLength(50);
    expect(d.ingredients).toHaveLength(50);
    expect(d.recipes).toHaveLength(50);
    expect(d.plans).toHaveLength(50);
    expect(d.days).toHaveLength(50 * 7);
    expect(d.meals).toHaveLength(50 * 28);
    expect(d.completions).toHaveLength(Math.ceil(50 / 20) * 20);
    expect(d.shoppingChecks).toHaveLength(50);
  });
});

describe('synthetic generator — ingredient names', () => {
  it('normalizeIngredientName applies NFKC, strips diacritics, lowercases, trims and collapses spaces', () => {
    expect(normalizeIngredientName('  Pechuga   de Pollo ')).toBe('pechuga de pollo');
    expect(normalizeIngredientName('Jalapeño')).toBe('jalapeno');
    expect(normalizeIngredientName('Ａｒｒｏｚ\tIntegral')).toBe('arroz integral');
    expect(normalizeIngredientName('ﬁdeos Árbol')).toBe('fideos arbol');
  });

  it('curated catalog has unique normalized names, valid units and complete nutrition', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(40);
    const names = CATALOG.map((i) => strictNormalize(i.name));
    expect(new Set(names).size).toBe(names.length);
    for (const ingredient of CATALOG) {
      expect(Object.values(IngredientType)).toContain(ingredient.type);
      expect(VALID_UNITS.has(ingredient.defaultUnit)).toBe(true);
      for (const key of ['calories', 'protein', 'carbs', 'fat', 'fiber'] as const) {
        expect(typeof ingredient.nutritionalValues[key]).toBe('number');
      }
    }
  });

  it('isolated: injected curated catalog with only "pechuga de pollo " collides with the base ingredient', () => {
    const catalog = [{ ...CATALOG[0], name: 'pechuga de pollo ' }];
    expectGenerationError(() => ingredientsOf({ count: 10, catalog }), 'ingredient_name_collision');
    expectGenerationError(() => generate(10, { catalog }), 'ingredient_name_collision');
  });

  it('injected catalog with two names equal under normalization collides', () => {
    const catalog = [
      ...CATALOG,
      { ...CATALOG[0], name: `  ${CATALOG[0].name.toUpperCase()} ` },
    ];
    expectGenerationError(() => ingredientsOf({ count: 100, catalog }), 'ingredient_name_collision');
  });

  it('generated ingredients carry type, valid default unit and complete nutrition', () => {
    for (const ingredient of ingredientsOf({ count: 200 })) {
      expect(ingredient.id).toMatch(SYNTH_ID);
      expect(tableCode(ingredient.id)).toBe('0007');
      expect(Object.values(IngredientType)).toContain(ingredient.type);
      expect(VALID_UNITS.has(ingredient.defaultUnit)).toBe(true);
      expect(typeof ingredient.nutritionalValues.fiber).toBe('number');
    }
  });
});

describe('synthetic generator — full volume (5000 users)', () => {
  let d: Dataset;
  let started = 0;

  beforeAll(() => {
    started = Date.now();
    d = generate(5000);
  }, 60_000);

  it('generates within a few seconds', () => {
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  it('has the expected counts per table', () => {
    expect(d.users).toHaveLength(5000);
    expect(d.profiles).toHaveLength(5000);
    expect(d.ingredients).toHaveLength(5000);
    expect(d.recipes).toHaveLength(5000);
    expect(d.plans).toHaveLength(5000);
    expect(d.days).toHaveLength(35_000);
    expect(d.meals).toHaveLength(140_000);
    expect(d.completions).toHaveLength(5000);
    expect(d.shoppingChecks).toHaveLength(5000);
  });

  it('all ids are unique, well-formed, use their table code and never collide with RECETA_POLLO_ID', () => {
    const tables: Array<[string, Array<{ id: string }>]> = [
      ['0001', d.users], ['0002', d.recipes], ['0003', d.plans], ['0004', d.days], ['0005', d.meals],
      ['0006', d.profiles], ['0007', d.ingredients], ['0008', d.completions], ['0009', d.shoppingChecks],
    ];
    const all = new Set<string>();
    let total = 0;
    for (const [code, rows] of tables) {
      for (const row of rows) {
        expect(row.id).toMatch(SYNTH_ID);
        expect(tableCode(row.id)).toBe(code);
        // the "9" prefix of the final segment is reserved for current-week ids
        expect(lastSegment(row.id).startsWith('9')).toBe(false);
        all.add(row.id);
        total += 1;
      }
    }
    expect(all.size).toBe(total);
    expect(all.has(RECETA_POLLO_ID)).toBe(false);
  });

  it('users: unique emails demo.seed.NNNNN@nutria.test and names "Demo Sintético NNNNN"', () => {
    d.users.forEach((user, i) => {
      expect(user.email).toBe(syntheticEmail(i + 1));
      expect(user.name).toBe(syntheticName(i + 1));
      expect(user.email).toMatch(/^demo\.seed\.\d{5}@nutria\.test$/);
      expect(user.email.startsWith('usuario.prueba')).toBe(false);
      expect(user.email.startsWith('qa.')).toBe(false);
    });
    expect(d.users[0].email).toBe('demo.seed.00001@nutria.test');
    expect(d.users[4999].email).toBe('demo.seed.05000@nutria.test');
    expect(new Set(d.users.map((u) => u.email)).size).toBe(5000);
    expect(new Set(d.users.map((u) => u.name)).size).toBe(5000);
  });

  it('5000 ingredient names are unique under strict normalization and never equal the base ingredients', () => {
    const normalized = d.ingredients.map((i) => strictNormalize(i.name));
    expect(new Set(normalized).size).toBe(5000);
    expect(new Set(d.ingredients.map((i) => i.name)).size).toBe(5000);
    const base = new Set([strictNormalize(PECHUGA_POLLO_SEED.name), strictNormalize(ARROZ_INTEGRAL_SEED.name)]);
    for (const name of normalized) expect(base.has(name)).toBe(false);
    // normalizeIngredientName agrees with the independent oracle
    d.ingredients.slice(0, 500).forEach((i) => expect(normalizeIngredientName(i.name)).toBe(strictNormalize(i.name)));
  });

  it('recipe ids are unique and every recipe ingredient exists in the ingredient table', () => {
    expect(new Set(d.recipes.map((r) => r.id)).size).toBe(5000);
    const names = new Set(d.ingredients.map((i) => i.name));
    for (const recipe of d.recipes) for (const item of recipe.ingredients) expect(names.has(item.name)).toBe(true);
  });

  it('profiles are 1:1 with users', () => {
    expect(new Set(d.profiles.map((p) => p.userId))).toEqual(new Set(d.users.map((u) => u.id)));
  });

  it('completions: 250 active users x 20 marks (14 COMPLETED, 4 SKIPPED, 2 NOT_LOGGED)', () => {
    const byUser = new Map<string, Record<string, number>>();
    for (const c of d.completions) {
      const counts = byUser.get(c.userId) ?? { COMPLETED: 0, SKIPPED: 0, NOT_LOGGED: 0 };
      counts[c.status] += 1;
      byUser.set(c.userId, counts);
    }
    expect(byUser.size).toBe(250);
    for (const counts of byUser.values()) {
      expect(counts).toEqual({ COMPLETED: 14, SKIPPED: 4, NOT_LOGGED: 2 });
    }
    expect(new Set(d.completions.map((c) => c.plannedMealId)).size).toBe(5000);
  });

  it('completions only target past plans of their own user, dated before BA today', () => {
    const idx = indexDataset(d);
    const today = dateInBuenosAires(NOW);
    for (const c of d.completions) {
      const meal = idx.mealById.get(c.plannedMealId)!;
      expect(meal).toBeDefined();
      const day = idx.dayById.get(meal.dayId)!;
      const plan = idx.planById.get(day.mealPlanId)!;
      expect(plan.userId).toBe(c.userId);
      expect(isoDay(day.date) < today).toBe(true);
      expect(c.recipeIdSnapshot).toBe(meal.recipeId);
    }
  });

  it('shopping checks: exactly one per past plan, owned by the plan user', () => {
    const planIds = d.shoppingChecks.map((c) => c.planId);
    expect(new Set(planIds)).toEqual(new Set(d.plans.map((p) => p.id)));
    const planById = new Map(d.plans.map((p) => [p.id, p]));
    for (const check of d.shoppingChecks) {
      expect(check.userId).toBe(planById.get(check.planId)!.userId);
      expect(check.itemKey).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('synthetic generator — plans (50 users)', () => {
  const d = generate(50);
  const idx = indexDataset(d);
  const mondays = Array.from({ length: PAST_PLAN_WEEKS }, (_, w) =>
    new Date(new Date(`${PAST_PLAN_FIRST_MONDAY}T00:00:00.000Z`).getTime() + w * 7 * DAY_MS));

  it('past plans start on fixed Mondays from 2026-01-05, rotating 40 weeks, end on Sunday', () => {
    expect(PAST_PLAN_FIRST_MONDAY).toBe('2026-01-05');
    expect(PAST_PLAN_WEEKS).toBe(40);
    const userIndex = new Map(d.users.map((u, i) => [u.id, i]));
    for (const plan of d.plans) {
      const i = userIndex.get(plan.userId)!;
      expect(plan.startDate.toISOString()).toBe(mondays[i % 40].toISOString());
      expect(plan.startDate.getUTCDay()).toBe(1);
      expect(plan.endDate.getTime() - plan.startDate.getTime()).toBe(6 * DAY_MS);
      expect(plan.isCurrent).toBe(true);
      expect(plan.version).toBe(1);
      expect(plan.endDate.getTime()).toBeLessThan(NOW.getTime());
    }
    expect(new Set(d.plans.map((p) => p.startDate.toISOString())).size).toBe(40);
    expect(new Set(d.plans.map((p) => p.userId)).size).toBe(50);
  });

  it('every plan is 7x4 complete, Monday..Sunday, B/L/S/D, same order as buildWeeklySlots', () => {
    for (const plan of d.plans) {
      const days = idx.daysByPlan.get(plan.id)!;
      expect(days).toHaveLength(7);
      const flattened = days.flatMap((day) =>
        (idx.mealsByDay.get(day.id) ?? []).map((meal) => ({ date: isoDay(day.date), day: day.day, mealType: meal.mealType })));
      const expected = buildWeeklySlots(plan.startDate).map(({ date, day, mealType }) => ({ date, day, mealType }));
      expect(flattened).toEqual(expected);
      expect(days[0].day).toBe(DayOfWeek.MONDAY);
      expect(days[6].day).toBe(DayOfWeek.SUNDAY);
    }
  });

  it('meal nutritionalValues deep-equal mapRecipeNutritionToMeal(recipe) and title is the recipe title', () => {
    for (const meal of d.meals) {
      const recipe = idx.recipesById.get(meal.recipeId)!;
      expect(recipe).toBeDefined();
      expect(meal.nutritionalValues).toEqual(mapRecipeNutritionToMeal(recipe));
      expect(meal.title).toBe(recipe.title);
    }
  });

  it('recipes are complete, MANUAL, with a fixed past createdAt and no image key', () => {
    const later = generate(50, { now: new Date('2027-03-01T12:00:00.000Z') });
    d.recipes.forEach((recipe, i) => {
      expect(recipe.description.trim().length).toBeGreaterThan(0);
      for (const key of ['calories', 'protein', 'fiber', 'carbs', 'fat'] as const) {
        expect(typeof recipe.nutritionalValues[key]).toBe('number');
        expect(Number.isFinite(recipe.nutritionalValues[key])).toBe(true);
      }
      expect(recipe.ingredients.length).toBeGreaterThan(0);
      for (const item of recipe.ingredients) {
        expect(VALID_UNITS.has(item.unit)).toBe(true);
        expect(typeof item.quantity).toBe('number');
        expect(item.quantity).toBeGreaterThan(0);
      }
      expect(recipe.instructions.length).toBeGreaterThan(0);
      recipe.instructions.forEach((step) => expect(step.trim().length).toBeGreaterThan(0));
      expect(recipe.origin).toBe('MANUAL');
      expect(recipe.createdAt).toBeInstanceOf(Date);
      expect(recipe.createdAt.getTime()).toBeLessThan(NOW.getTime());
      expect(recipe.createdAt.getTime()).toBe(later.recipes[i].createdAt.getTime()); // fixed, not derived from now
      expect(Object.prototype.hasOwnProperty.call(recipe, 'image')).toBe(false);
      recipe.categories.forEach((category) => expect(Object.values(RecipeCategory)).toContain(category));
    });
  });

  it('recipe categories are consistent with their ingredients (contradictions config as oracle)', () => {
    const contradictions = RECIPE_VALIDATION_CONFIG.contradictions as unknown as Partial<Record<string, string[]>>;
    for (const recipe of d.recipes) {
      for (const category of recipe.categories) {
        const groups = contradictions[category];
        if (groups) expect(findExcludedIngredientInSource(recipe, groups)).toBeNull();
      }
    }
  });

  it('profiles use only enum values', () => {
    for (const profile of d.profiles) {
      expect(Object.values(NutritionGoal)).toContain(profile.goal);
      expect(Object.values(Diet)).toContain(profile.diet);
      expect(Object.values(CookTimePreference)).toContain(profile.cookTimePreference);
      profile.excludedIngredients.forEach((r) => expect(Object.values(DietaryRestriction)).toContain(r));
    }
  });

  it('completions: mix of COMPLETED, SKIPPED, NOT_LOGGED and meals without row in each active plan', () => {
    const statuses = new Set(d.completions.map((c) => c.status));
    expect(statuses).toEqual(new Set([MealCompletionStatus.COMPLETED, MealCompletionStatus.SKIPPED, MealCompletionStatus.NOT_LOGGED]));
    const activeUsers = new Set(d.completions.map((c) => c.userId));
    expect(activeUsers.size).toBe(Math.ceil(50 / 20));
    for (const userId of activeUsers) {
      const plan = d.plans.find((p) => p.userId === userId)!;
      const marked = d.completions.filter((c) => c.userId === userId).length;
      expect(idx.mealsOfPlan(plan.id).length - marked).toBe(8); // 28 meals, 20 marked, 8 without row
    }
  });

  it('shopping checks: itemKey sha256 hex present in transformShoppingList(weekStart, plan) keys, mixed checked', () => {
    const checked = new Set<boolean>();
    const seen = new Set<string>();
    for (const check of d.shoppingChecks) {
      const plan = idx.planById.get(check.planId)!;
      const days = idx.daysByPlan.get(plan.id)!;
      const result = transformShoppingList(isoDay(plan.startDate), shoppingPlanFor(plan, days, idx.mealsByDay, idx.recipesById));
      expect(result.warnings).toEqual([]);
      result.items.forEach((item) => expect(item.quantity).not.toBeNull());
      expect(check.itemKey).toMatch(/^[0-9a-f]{64}$/);
      expect(result.items.map((item) => item.key)).toContain(check.itemKey);
      const unique = `${check.userId}|${check.planId}|${check.itemKey}`;
      expect(seen.has(unique)).toBe(false);
      seen.add(unique);
      checked.add(check.checked);
    }
    expect(checked).toEqual(new Set([true, false]));
  });
});

describe('synthetic generator — diet and restriction compatibility (200 users)', () => {
  const d = generate(200);
  const idx = indexDataset(d);

  function plannedRecipesOf(diet: string) {
    return d.plans
      .filter((plan) => idx.profileByUser.get(plan.userId)!.diet === diet)
      .flatMap((plan) => idx.mealsOfPlan(plan.id).map((meal) => ({ meal, recipe: idx.recipesById.get(meal.recipeId)! })));
  }

  it('covers every diet and at least some restrictions', () => {
    expect(new Set(d.profiles.map((p) => p.diet))).toEqual(new Set(Object.values(Diet)));
    expect(d.profiles.some((p) => p.excludedIngredients.length > 0)).toBe(true);
    expect(d.profiles.some((p) => p.excludedIngredients.length === 0)).toBe(true);
  });

  it('every planned recipe respects diet (VEGAN/VEGETARIAN/PESCATARIAN/ALL) and excluded ingredients', () => {
    const cache = new Map<string, string | null>();
    for (const plan of d.plans) {
      const profile = idx.profileByUser.get(plan.userId)!;
      const forbidden = profileForbiddenRestrictions(profile);
      const key = forbidden.slice().sort().join(',');
      for (const meal of idx.mealsOfPlan(plan.id)) {
        const cacheKey = `${meal.recipeId}|${key}`;
        if (!cache.has(cacheKey)) {
          cache.set(cacheKey, findExcludedIngredientInSource(idx.recipesById.get(meal.recipeId)!, forbidden));
        }
        expect({ plan: plan.id, diet: profile.diet, violation: cache.get(cacheKey) })
          .toEqual({ plan: plan.id, diet: profile.diet, violation: null });
      }
    }
  });

  it('KETO (seed-only rule): carbs <= 10 g per serving, no GRAIN, no sugar, no sweet fruits', () => {
    const rows = plannedRecipesOf(Diet.KETO);
    expect(rows.length).toBeGreaterThan(0);
    for (const { recipe } of rows) {
      expect(recipe.nutritionalValues.carbs).toBeLessThanOrEqual(10);
      expect(findExcludedIngredientInSource(recipe, ['gluten'])).toBeNull();
      for (const item of recipe.ingredients) {
        expect(idx.ingredientsByName.get(item.name)!.type).not.toBe(IngredientType.GRAIN);
        expect(hasWord(item.name, GRAIN_WORDS)).toBeNull();
        expect(hasWord(item.name, KETO_SUGAR_WORDS)).toBeNull();
        expect(hasWord(item.name, SWEET_FRUIT_WORDS)).toBeNull();
      }
    }
  });

  it('PALEO (seed-only rule): no GRAIN, no DAIRY, no legumes, no added sugar', () => {
    const rows = plannedRecipesOf(Diet.PALEO);
    expect(rows.length).toBeGreaterThan(0);
    for (const { recipe } of rows) {
      expect(findExcludedIngredientInSource(recipe, ['gluten', 'dairy'])).toBeNull();
      for (const item of recipe.ingredients) {
        const type = idx.ingredientsByName.get(item.name)!.type;
        expect(type).not.toBe(IngredientType.GRAIN);
        expect(type).not.toBe(IngredientType.DAIRY);
        expect(hasWord(item.name, GRAIN_WORDS)).toBeNull();
        expect(hasWord(item.name, LEGUME_WORDS)).toBeNull();
        expect(hasWord(item.name, SUGAR_WORDS)).toBeNull();
      }
    }
  });

  it.each([Diet.KETO, Diet.PALEO])('%s has >= 7 distinct recipes per meal type across its plans', (diet) => {
    const rows = plannedRecipesOf(diet);
    for (const mealType of MEAL_TYPES) {
      const distinct = new Set(rows.filter(({ meal }) => meal.mealType === mealType).map(({ recipe }) => recipe.id));
      expect({ diet, mealType, enough: distinct.size >= 7 }).toEqual({ diet, mealType, enough: true });
    }
  });
});

describe('current week of 00001 — Buenos Aires Monday', () => {
  it.each([
    ['2026-11-09T02:30:00.000Z', '2026-11-02'], // Sunday 23:30 BA -> previous week
    ['2026-11-09T03:30:00.000Z', '2026-11-09'], // Monday 00:30 BA
    ['2026-11-09T05:00:00.000Z', '2026-11-09'], // Monday 02:00 BA
    ['2026-11-11T15:00:00.000Z', '2026-11-09'], // Wednesday
    ['2026-11-16T02:59:00.000Z', '2026-11-09'], // Sunday 23:59 BA
  ])('now=%s -> week %s', (now, monday) => {
    expect(currentWeekMonday(new Date(now))).toBe(monday);
  });
});

describe('current week of 00001 — plan, days, meals', () => {
  const d = generate(50);
  const idx = indexDataset(d);
  const cw = currentWeekOf(new Date('2026-11-09T02:30:00.000Z'), d);
  const curatedNames = new Set(CATALOG.map((i) => i.name));

  it('uses the BA Monday and derived ids', () => {
    expect(cw.monday).toBe('2026-11-02');
    expect(cw.plan.id).toBe('5eed0003-0000-4000-8000-920261102000');
    expect(cw.plan.userId).toBe(d.users[0].id);
    expect(cw.plan.startDate.toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(cw.plan.endDate.toISOString()).toBe('2026-11-08T00:00:00.000Z');
    expect(cw.plan.isCurrent).toBe(true);
    expect(cw.days.map((day) => day.id)).toEqual(
      Array.from({ length: 7 }, (_, i) => `5eed0004-0000-4000-8000-92026110200${i}`));
    expect(cw.meals.map((meal) => meal.id)).toEqual(
      Array.from({ length: 28 }, (_, k) => `5eed0005-0000-4000-8000-9202611020${Math.floor(k / 4)}${k % 4}`));
    cw.days.forEach((day) => expect(day.mealPlanId).toBe(cw.plan.id));
  });

  it('differs from the past plan week of 00001', () => {
    const past = d.plans.find((p) => p.userId === d.users[0].id)!;
    expect(past.startDate.toISOString()).not.toBe(cw.plan.startDate.toISOString());
  });

  it('is 7x4 in buildWeeklySlots order', () => {
    const mealsOf = (dayId: string) => cw.meals.filter((m) => m.dayId === dayId);
    const flattened = cw.days.flatMap((day) =>
      mealsOf(day.id).map((meal) => ({ date: isoDay(day.date), day: day.day, mealType: meal.mealType })));
    expect(flattened).toEqual(buildWeeklySlots(cw.plan.startDate).map(({ date, day, mealType }) => ({ date, day, mealType })));
  });

  it('uses only curated-catalog recipes compatible with the 00001 profile, with mapped nutrition', () => {
    const profile = idx.profileByUser.get(d.users[0].id)!;
    const forbidden = profileForbiddenRestrictions(profile);
    for (const meal of cw.meals) {
      const recipe = idx.recipesById.get(meal.recipeId)!;
      expect(recipe).toBeDefined();
      recipe.ingredients.forEach((item) => expect(curatedNames.has(item.name)).toBe(true));
      expect(findExcludedIngredientInSource(recipe, forbidden)).toBeNull();
      expect(meal.nutritionalValues).toEqual(mapRecipeNutritionToMeal(recipe));
    }
  });
});

describe('current week of 00001 — completions (only days strictly before BA today)', () => {
  const d = generate(50);
  const cw = currentWeekOf(new Date('2026-11-09T15:00:00.000Z'), d); // week 2026-11-09
  const reread = cw.meals.map((meal, i) => ({
    id: meal.id,
    dayId: meal.dayId,
    recipeId: meal.recipeId,
    updatedAt: new Date(Date.UTC(2026, 10, 9, 13, 0, i)),
  }));
  const marksAt = (now: string) =>
    buildCurrentWeekCompletions({ now: new Date(now), userId: d.users[0].id, days: cw.days, meals: reread }) as SpecCurrentWeekMark[];
  const dayIndexOf = (mealId: string) => Number(mealId.slice(-2, -1));

  it('now = Monday -> 0 marks', () => {
    expect(marksAt('2026-11-09T15:00:00.000Z')).toEqual([]);
  });

  it('now = Monday 00:30 BA -> 0 marks (does not fall back to the previous week)', () => {
    expect(marksAt('2026-11-09T03:30:00.000Z')).toEqual([]);
  });

  it('now = Wednesday -> only Monday and Tuesday, with matching ids and snapshots', () => {
    const marks = marksAt('2026-11-11T15:00:00.000Z');
    expect(marks.length).toBeGreaterThan(0);
    const mealById = new Map(reread.map((m) => [m.id, m]));
    for (const mark of marks) {
      expect([0, 1]).toContain(dayIndexOf(mark.plannedMealId));
      expect(lastSegment(mark.id)).toBe(lastSegment(mark.plannedMealId));
      expect(mark.id.startsWith('5eed0008-0000-4000-8000-920261109')).toBe(true);
      expect(mark.userId).toBe(d.users[0].id);
      const meal = mealById.get(mark.plannedMealId)!;
      expect(mark.recipeIdSnapshot).toBe(meal.recipeId);
      expect(mark.mealUpdatedAtSnapshot.getTime()).toBe(meal.updatedAt.getTime());
    }
  });

  it('fixed per-day pattern: each past day has rows and at least one meal without row; all statuses appear', () => {
    const marks = marksAt('2026-11-11T15:00:00.000Z');
    for (const day of [0, 1]) {
      const count = marks.filter((m) => dayIndexOf(m.plannedMealId) === day).length;
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(4);
    }
    expect(new Set(marks.map((m) => m.status))).toEqual(
      new Set([MealCompletionStatus.COMPLETED, MealCompletionStatus.SKIPPED, MealCompletionStatus.NOT_LOGGED]));
  });

  it('exact pattern for Monday (C, C, S, none) and Tuesday (C, N, C, none) by meal order B/L/S/D', () => {
    // The KPI integration test ("report date = yesterday" -> C=2 of N=4 on Tuesday) relies on this pattern.
    const marks = marksAt('2026-11-11T15:00:00.000Z');
    const statusAt = (day: number, meal: number) =>
      marks.find((m) => m.plannedMealId.endsWith(`0${day}${meal}`))?.status ?? 'none';
    expect([0, 1, 2, 3].map((meal) => statusAt(0, meal))).toEqual([
      MealCompletionStatus.COMPLETED, MealCompletionStatus.COMPLETED, MealCompletionStatus.SKIPPED, 'none']);
    expect([0, 1, 2, 3].map((meal) => statusAt(1, meal))).toEqual([
      MealCompletionStatus.COMPLETED, MealCompletionStatus.NOT_LOGGED, MealCompletionStatus.COMPLETED, 'none']);
  });

  it('pattern does not depend on now: Wednesday marks are a subset of Sunday-night marks', () => {
    const wednesday = marksAt('2026-11-11T15:00:00.000Z');
    const sunday = marksAt('2026-11-16T02:30:00.000Z'); // Sunday 23:30 BA
    expect(sunday.filter((m) => [0, 1].includes(dayIndexOf(m.plannedMealId)))).toEqual(wednesday);
    expect(sunday.some((m) => dayIndexOf(m.plannedMealId) === 5)).toBe(true);
    expect(sunday.some((m) => dayIndexOf(m.plannedMealId) === 6)).toBe(false); // today (Sunday) never marked
  });
});

describe('current week of 00001 — shopping checks', () => {
  const d = generate(50);
  const idx = indexDataset(d);
  const cw = currentWeekOf(new Date('2026-11-11T15:00:00.000Z'), d);
  const plan = shoppingPlanFor(cw.plan, cw.days, (dayId) => cw.meals.filter((m) => m.dayId === dayId), idx.recipesById);
  const checks = buildCurrentWeekShoppingChecks({ monday: cw.monday, userId: d.users[0].id, plan }) as SpecShoppingCheck[];
  const expectedKeys = transformShoppingList(cw.monday, plan).items.map((item) => item.key);

  it('one check per shopping list item, same keys as transformShoppingList', () => {
    expect(expectedKeys.length).toBeGreaterThan(0);
    expect(checks.map((c) => c.itemKey).sort()).toEqual(expectedKeys.slice().sort());
    checks.forEach((c) => {
      expect(c.itemKey).toMatch(/^[0-9a-f]{64}$/);
      expect(c.userId).toBe(d.users[0].id);
      expect(c.planId).toBe(cw.plan.id);
    });
  });

  it('ids are 5eed0009-…-9YYYYMMDDIII, unique, and checked is mixed', () => {
    checks.forEach((c) => expect(c.id).toMatch(/^5eed0009-0000-4000-8000-920261109\d{3}$/));
    expect(new Set(checks.map((c) => c.id)).size).toBe(checks.length);
    expect(new Set(checks.map((c) => c.checked))).toEqual(new Set([true, false]));
  });

  it('is deterministic (same input, same checks)', () => {
    expect(buildCurrentWeekShoppingChecks({ monday: cw.monday, userId: d.users[0].id, plan })).toEqual(checks);
  });

  it('item keys depend only on plan content, not version/updatedAt (sanity on the oracle)', () => {
    const bumped = { ...plan, version: 9, updatedAt: new Date('2030-01-01T00:00:00.000Z') };
    expect(transformShoppingList(cw.monday, bumped).items.map((i) => i.key)).toEqual(expectedKeys);
  });
});
