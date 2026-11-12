/**
 * NUT-114 — Block 1 correction (TDD red first): combinatorial ingredient variants must be USED by the mass recipes.
 *
 * Review finding: buildIngredients() creates ~4937 combinatorial rows (base x presentation x size, e.g.
 * "Muslo de pollo a granel 100 g") but no recipe references any of them. Approved design (D3): the mass recipes use the
 * combinatorial ingredients; the walkthrough account 00001 (current week) uses only the curated catalog.
 *
 * Expected NEW API of `apps/api/prisma/synthetic/generate.ts` (pure, deterministic, no I/O):
 *
 *   export type SyntheticUnit = 'g' | 'ml' | 'unidad';
 *
 *   export interface SyntheticIngredientVariant {
 *     baseName: string;                 // exact `name` of the CURATED_INGREDIENTS entry it derives from
 *     presentation: string;             // presentation text contained in the name, e.g. 'a granel'
 *     unit: SyntheticUnit;              // always the base's defaultUnit (and the row's defaultUnit)
 *     // Package size stated in the name, expressed IN `unit` ('1 kg' -> { 1000, 'g' }, '1,5 l' -> { 1500, 'ml' },
 *     // 'x 6 unidades' -> { 6, 'unidad' }); null only when the name carries no size text.
 *     packageSize: { quantity: number; unit: SyntheticUnit } | null;
 *   }
 *
 *   // Describes a combinatorial name produced by buildIngredients() with the default catalog.
 *   // Returns null for curated names (CURATED_INGREDIENTS) and for any name the generator does not produce.
 *   export function describeSyntheticIngredient(name: string): SyntheticIngredientVariant | null;
 *
 *   // Combinatorial rows = dataset.ingredients whose describeSyntheticIngredient(name) !== null.
 *   // used = how many of those rows are referenced by name in at least one dataset.recipes[*].ingredients item.
 *   // percent = used / total * 100 (0 when total = 0). Pure: same input, same output.
 *   export function combinatorialUsage(dataset: {
 *     ingredients: ReadonlyArray<{ name: string }>;
 *     recipes: ReadonlyArray<{ ingredients: ReadonlyArray<{ name: string }> }>;
 *   }): { total: number; used: number; percent: number };
 *
 * Behavior required (user's explicit conditions):
 *   1. 5000 users: combinatorialUsage(d).percent >= 90 and equals used/total*100. For every volume (10, 50, 100, 200,
 *      5000) every recipe ingredient name exists in dataset.ingredients (no dangling names).
 *   2. Every combinatorial ingredient used by a recipe classifies exactly like its curated base: same result
 *      (null / non-null) of findExcludedIngredientInSource({ ingredients: [{ name }] }, [group]) for EVERY group of the
 *      domain dictionary (nuts, dairy, gluten, shellfish, soy, meat, fish, egg, honey), same IngredientType, and same
 *      seed-only KETO/PALEO keyword classification (grain, sugar, keto sugar, sweet fruit, legume words).
 *   3. Unit coherence: recipe items that use a variant have a unit of the variant's family (g/kg <-> 'g',
 *      ml/l <-> 'ml', 'unidad' <-> 'unidad'); when the name carries a size, 0 < quantity (in variant unit) <=
 *      4 x packageSize. The size text of the name agrees with packageSize (parsed independently here).
 *   4. The current week of 00001 uses only curated names (describeSyntheticIngredient(name) === null), also at 5000.
 *   5. Diet / restriction compatibility and shopping lists without warnings still hold when variants are used.
 */
import { Diet, IngredientType } from '@/generated/prisma/client';
import { transformShoppingList } from '@/modules/shopping-list/shopping-list.transform';
import {
  findExcludedIngredientInSource,
  IngredientGroup,
  profileForbiddenRestrictions,
} from '@/modules/recipe/validation/ingredient-dictionary';
import { CURATED_INGREDIENTS } from '../../../prisma/synthetic/catalog';
import {
  buildCurrentWeek,
  combinatorialUsage,
  describeSyntheticIngredient,
  generateSyntheticDataset,
} from '../../../prisma/synthetic/generate';

// ---------- fixtures & independent helpers ----------

const NOW = new Date('2026-11-11T15:00:00.000Z'); // Wednesday 12:00 in Buenos Aires
const DEMO_HASH = '$2b$04$QL597mIXc6JauPDhUTUPR.uUjvBlSb9NxRWu5xn4egJ78KrMILTNK';

// Expected shapes, declared here so this spec type-checks on its own (same style as seed-synthetic.generate.spec.ts).
type SpecUnit = 'g' | 'ml' | 'unidad';
interface SpecVariant {
  baseName: string;
  presentation: string;
  unit: SpecUnit;
  packageSize: { quantity: number; unit: SpecUnit } | null;
}
interface SpecUsage { total: number; used: number; percent: number }
interface SpecCuratedIngredient { name: string; type: IngredientType; defaultUnit: string }
interface SpecIngredient extends SpecCuratedIngredient { id: string }
interface SpecRecipe {
  id: string;
  title: string;
  ingredients: Array<{ name: string; quantity: number; unit: string }>;
  nutritionalValues: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
}
interface SpecProfile { userId: string; diet: Diet; excludedIngredients: string[] }
interface SpecPlan { id: string; userId: string; startDate: Date }
interface SpecDay { id: string; mealPlanId: string; date: Date }
interface SpecMeal { id: string; dayId: string; mealType: string; recipeId: string }
interface SpecDataset {
  ingredients: SpecIngredient[];
  users: Array<{ id: string }>;
  profiles: SpecProfile[];
  recipes: SpecRecipe[];
  plans: SpecPlan[];
  days: SpecDay[];
  meals: SpecMeal[];
}
interface SpecCurrentWeek { monday: string; plan: { id: string }; days: SpecDay[]; meals: SpecMeal[] }

const CATALOG = CURATED_INGREDIENTS as readonly SpecCuratedIngredient[];
const CURATED_BY_NAME = new Map(CATALOG.map((i) => [i.name, i]));
const describe_ = (name: string) => describeSyntheticIngredient(name) as SpecVariant | null;
const usageOf = (d: SpecDataset) => combinatorialUsage(d) as SpecUsage;
const generate = (users: number) =>
  generateSyntheticDataset({ users, demoPasswordHash: DEMO_HASH, now: NOW }) as unknown as SpecDataset;
const currentWeekOf = (now: Date, dataset: SpecDataset) =>
  buildCurrentWeek({ now, dataset } as unknown as Parameters<typeof buildCurrentWeek>[0]) as unknown as SpecCurrentWeek;

// Every group the domain dictionary defines. Record<IngredientGroup, true> fails type-check if a group is added there.
const DOMAIN_GROUP_SET: Record<IngredientGroup, true> = {
  nuts: true, dairy: true, gluten: true, shellfish: true, soy: true, meat: true, fish: true, egg: true, honey: true,
};
const DOMAIN_GROUPS = Object.keys(DOMAIN_GROUP_SET) as IngredientGroup[];

function strictNormalize(value: string): string {
  return value.normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}
function hasWord(text: string, words: readonly string[]): string | null {
  const normalized = strictNormalize(text);
  return words.find((word) => new RegExp(`\\b${word}(s|es)?\\b`).test(normalized)) ?? null;
}
// Same seed-only KETO/PALEO word lists as seed-synthetic.generate.spec.ts.
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
const KEYWORD_LISTS: Record<string, readonly string[]> = {
  grain: GRAIN_WORDS, sugar: SUGAR_WORDS, ketoSugar: KETO_SUGAR_WORDS, sweetFruit: SWEET_FRUIT_WORDS, legume: LEGUME_WORDS,
};

/** Domain + seed-only fingerprint of a single ingredient name (what diet filtering can observe). */
function classify(name: string): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const group of DOMAIN_GROUPS) {
    result[`domain:${group}`] = findExcludedIngredientInSource({ ingredients: [{ name }] }, [group]) !== null;
  }
  for (const [list, words] of Object.entries(KEYWORD_LISTS)) result[`seed:${list}`] = hasWord(name, words) !== null;
  return result;
}

/** Unit family in the variant unit, with the factor that converts a recipe quantity into it. */
function unitFamily(unit: string): { family: SpecUnit; factor: number } | null {
  switch (unit) {
    case 'g': return { family: 'g', factor: 1 };
    case 'kg': return { family: 'g', factor: 1000 };
    case 'ml': return { family: 'ml', factor: 1 };
    case 'l': return { family: 'ml', factor: 1000 };
    case 'unidad': return { family: 'unidad', factor: 1 };
    default: return null;
  }
}

/** Independent parser of the size text at the end of a name ("400 g", "1 kg", "1,5 l", "x 6 unidades"). */
function sizeFromName(name: string): { quantity: number; unit: SpecUnit } | null {
  const units = /(?:^|\s)x\s*(\d+)\s*unidad(?:es)?$/i.exec(name);
  if (units) return { quantity: Number(units[1]), unit: 'unidad' };
  const measure = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)$/i.exec(name);
  if (!measure) return null;
  const family = unitFamily(measure[2].toLowerCase())!;
  return { quantity: Math.round(Number(measure[1].replace(',', '.')) * family.factor), unit: family.family };
}

function usedNames(d: SpecDataset): Set<string> {
  return new Set(d.recipes.flatMap((r) => r.ingredients.map((i) => i.name)));
}

// One 5000-user dataset shared by every describe of this file.
let full: SpecDataset;
beforeAll(() => {
  full = generate(5000);
}, 60_000);

// ---------- 0. describeSyntheticIngredient contract ----------

describe('describeSyntheticIngredient — contract', () => {
  it('returns null for every curated name and for names the generator never produces', () => {
    for (const ingredient of CATALOG) expect({ name: ingredient.name, v: describe_(ingredient.name) }).toEqual({ name: ingredient.name, v: null });
    expect(describe_('Pechuga de Pollo')).toBeNull();
    expect(describe_('Arroz Integral')).toBeNull();
    expect(describe_('Ingrediente inexistente en lata 400 g')).toBeNull();
    expect(describe_('')).toBeNull();
  });

  it('describes exactly the combinatorial rows of the 5000-user dataset (all non-curated rows)', () => {
    const offenders: string[] = [];
    let combinatorial = 0;
    for (const row of full.ingredients) {
      const v = describe_(row.name);
      const curated = CURATED_BY_NAME.has(row.name);
      if (curated) {
        if (v !== null) offenders.push(`${row.name}: curated but described`);
        continue;
      }
      combinatorial += 1;
      if (v === null) {
        offenders.push(`${row.name}: combinatorial but not described`);
        continue;
      }
      const base = CURATED_BY_NAME.get(v.baseName);
      if (!base) offenders.push(`${row.name}: baseName "${v.baseName}" is not curated`);
      else {
        if (v.unit !== base.defaultUnit) offenders.push(`${row.name}: unit ${v.unit} != base ${base.defaultUnit}`);
        if (row.defaultUnit !== v.unit) offenders.push(`${row.name}: row defaultUnit ${row.defaultUnit} != ${v.unit}`);
      }
      if (!row.name.startsWith(`${v.baseName} `)) offenders.push(`${row.name}: does not start with base "${v.baseName}"`);
      if (!v.presentation || !row.name.includes(v.presentation)) offenders.push(`${row.name}: presentation "${v.presentation}" not in name`);
    }
    expect(offenders.slice(0, 30)).toEqual([]);
    expect(combinatorial).toBe(full.ingredients.length - CATALOG.length);
  });

  it('packageSize agrees with the size text of the name (independent parser)', () => {
    const offenders: string[] = [];
    for (const row of full.ingredients) {
      const v = describe_(row.name);
      if (!v) continue;
      const parsed = sizeFromName(row.name);
      const actual = v.packageSize ? { quantity: v.packageSize.quantity, unit: v.packageSize.unit } : null;
      if (JSON.stringify(parsed) !== JSON.stringify(actual)) {
        offenders.push(`${row.name}: name says ${JSON.stringify(parsed)}, packageSize ${JSON.stringify(actual)}`);
      }
      if (v.packageSize && v.packageSize.unit !== v.unit) offenders.push(`${row.name}: packageSize unit != unit`);
    }
    expect(offenders.slice(0, 30)).toEqual([]);
  });
});

// ---------- 1. usage and dangling names ----------

describe('combinatorial ingredients — usage by mass recipes (5000 users)', () => {
  it('>= 90 % of combinatorial ingredient rows appear in at least one recipe; combinatorialUsage reports it exactly', () => {
    const names = usedNames(full);
    const combinatorial = full.ingredients.filter((i) => describe_(i.name) !== null);
    const used = combinatorial.filter((i) => names.has(i.name)).length;
    const usage = usageOf(full);
    expect({ total: usage.total, used: usage.used }).toEqual({ total: combinatorial.length, used });
    expect(usage.total).toBe(full.ingredients.length - CATALOG.length);
    expect(usage.percent).toBeCloseTo((usage.used / usage.total) * 100, 10);
    // The percentage (2 decimals) is part of the assertion message on failure.
    expect({ percent: usage.percent.toFixed(2), atLeast90: usage.percent >= 90 })
      .toEqual({ percent: usage.percent.toFixed(2), atLeast90: true });
  });

  it('combinatorialUsage is pure and counts only described rows', () => {
    expect(usageOf(full)).toEqual(usageOf(full));
    const tiny = {
      ingredients: [{ name: CATALOG[0].name }, { name: 'Nombre ajeno' }],
      recipes: [{ ingredients: [{ name: CATALOG[0].name }] }],
    };
    expect(combinatorialUsage(tiny)).toEqual({ total: 0, used: 0, percent: 0 });
  });

  it('every recipe ingredient name exists in the ingredient table (5000 users)', () => {
    const table = new Set(full.ingredients.map((i) => i.name));
    const dangling = [...usedNames(full)].filter((name) => !table.has(name));
    expect(dangling).toEqual([]);
  });

  it.each([10, 50, 100, 200])('every recipe ingredient name exists in the ingredient table (users = %p)', (users) => {
    const d = generate(users);
    const table = new Set(d.ingredients.map((i) => i.name));
    const dangling = [...usedNames(d)].filter((name) => !table.has(name));
    expect({ users, dangling }).toEqual({ users, dangling: [] });
  });
});

// ---------- 2. domain classification equality ----------

describe('combinatorial ingredients — classify exactly like their curated base', () => {
  it('enumerates every domain dictionary group', () => {
    expect(DOMAIN_GROUPS.sort()).toEqual(['dairy', 'egg', 'fish', 'gluten', 'honey', 'meat', 'nuts', 'shellfish', 'soy']);
  });

  it('every variant used by a recipe: same domain groups, same IngredientType and same KETO/PALEO keyword classes', () => {
    const rowByName = new Map(full.ingredients.map((i) => [i.name, i]));
    const usedVariants = [...usedNames(full)].filter((name) => describe_(name) !== null);
    expect(usedVariants.length).toBeGreaterThan(0);
    const baseCache = new Map<string, Record<string, boolean>>();
    const offenders: string[] = [];
    for (const name of usedVariants) {
      const v = describe_(name)!;
      const base = CURATED_BY_NAME.get(v.baseName);
      const row = rowByName.get(name);
      if (!base || !row) {
        offenders.push(`${name}: missing base or row`);
        continue;
      }
      if (row.type !== base.type) offenders.push(`${name}: type ${row.type} != base ${base.type}`);
      let expected = baseCache.get(base.name);
      if (!expected) {
        expected = classify(base.name);
        baseCache.set(base.name, expected);
      }
      const actual = classify(name);
      const diff = Object.keys(expected).filter((key) => expected![key] !== actual[key]);
      if (diff.length > 0) offenders.push(`${name} (base ${base.name}): ${diff.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});

// ---------- 3. unit coherence ----------

describe('combinatorial ingredients — recipe units are coherent with the variant', () => {
  it('unit family matches and 0 < quantity <= 4 x package size', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const recipe of full.recipes) {
      for (const item of recipe.ingredients) {
        const v = describe_(item.name);
        if (!v) continue;
        checked += 1;
        const family = unitFamily(item.unit);
        if (!family || family.family !== v.unit) {
          offenders.push(`${recipe.id} ${item.name}: unit ${item.unit} not in family ${v.unit}`);
          continue;
        }
        const quantity = item.quantity * family.factor;
        if (!(quantity > 0)) offenders.push(`${recipe.id} ${item.name}: quantity ${item.quantity}`);
        if (v.packageSize && quantity > 4 * v.packageSize.quantity) {
          offenders.push(`${recipe.id} ${item.name}: ${item.quantity} ${item.unit} > 4 x ${v.packageSize.quantity} ${v.packageSize.unit}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(offenders.slice(0, 30)).toEqual([]);
  });
});

// ---------- 4. current week of 00001 stays curated ----------

describe('current week of 00001 — only curated ingredient names, even when variants are used', () => {
  it.each([
    ['2026-11-11T15:00:00.000Z'],
    ['2026-11-09T02:30:00.000Z'],
    ['2027-02-17T15:00:00.000Z'],
  ])('5000 users, now=%s', (now) => {
    const cw = currentWeekOf(new Date(now), full);
    const recipesById = new Map(full.recipes.map((r) => [r.id, r]));
    expect(cw.meals).toHaveLength(28);
    const offenders = cw.meals.flatMap((meal) => {
      const recipe = recipesById.get(meal.recipeId);
      if (!recipe) return [`${meal.id}: missing recipe`];
      return recipe.ingredients
        .filter((item) => describe_(item.name) !== null || !CURATED_BY_NAME.has(item.name))
        .map((item) => `${recipe.id} ${item.name}`);
    });
    expect(offenders).toEqual([]);
  });

  it('50 users: same rule', () => {
    const d = generate(50);
    const cw = currentWeekOf(NOW, d);
    const recipesById = new Map(d.recipes.map((r) => [r.id, r]));
    for (const meal of cw.meals) {
      for (const item of recipesById.get(meal.recipeId)!.ingredients) {
        expect({ name: item.name, variant: describe_(item.name), curated: CURATED_BY_NAME.has(item.name) })
          .toEqual({ name: item.name, variant: null, curated: true });
      }
    }
  });
});

// ---------- 5. diet compatibility and shopping list still hold with variants (5000 users, sampled plans) ----------

describe('5000 users — variants keep diet compatibility and clean shopping lists (every 13th plan)', () => {
  const sample = () => full.plans.filter((_, i) => i % 13 === 0);

  function index(d: SpecDataset) {
    const recipesById = new Map(d.recipes.map((r) => [r.id, r]));
    const rowByName = new Map(d.ingredients.map((i) => [i.name, i]));
    const profileByUser = new Map(d.profiles.map((p) => [p.userId, p]));
    const daysByPlan = new Map<string, SpecDay[]>();
    for (const day of d.days) daysByPlan.set(day.mealPlanId, [...(daysByPlan.get(day.mealPlanId) ?? []), day]);
    const mealsByDay = new Map<string, SpecMeal[]>();
    for (const meal of d.meals) mealsByDay.set(meal.dayId, [...(mealsByDay.get(meal.dayId) ?? []), meal]);
    return { recipesById, rowByName, profileByUser, daysByPlan, mealsByDay };
  }

  it('sampled plans actually use combinatorial ingredients', () => {
    const idx = index(full);
    const hasVariant = sample().some((plan) => (idx.daysByPlan.get(plan.id) ?? []).some((day) =>
      (idx.mealsByDay.get(day.id) ?? []).some((meal) =>
        idx.recipesById.get(meal.recipeId)!.ingredients.some((item) => describe_(item.name) !== null))));
    expect(hasVariant).toBe(true);
  });

  it('domain restrictions and seed-only KETO/PALEO rules hold for every sampled planned recipe', () => {
    const idx = index(full);
    const cache = new Map<string, string | null>();
    const offenders: string[] = [];
    for (const plan of sample()) {
      const profile = idx.profileByUser.get(plan.userId)!;
      const forbidden = profileForbiddenRestrictions(profile);
      const key = forbidden.slice().sort().join(',');
      for (const day of idx.daysByPlan.get(plan.id) ?? []) {
        for (const meal of idx.mealsByDay.get(day.id) ?? []) {
          const recipe = idx.recipesById.get(meal.recipeId)!;
          const cacheKey = `${recipe.id}|${key}`;
          if (!cache.has(cacheKey)) cache.set(cacheKey, findExcludedIngredientInSource(recipe, forbidden));
          const violation = cache.get(cacheKey);
          if (violation) offenders.push(`${plan.id} ${profile.diet} ${recipe.id}: ${violation}`);
          for (const item of recipe.ingredients) {
            const type = idx.rowByName.get(item.name)?.type;
            if (profile.diet === Diet.KETO && (type === IngredientType.GRAIN || hasWord(item.name, GRAIN_WORDS)
              || hasWord(item.name, KETO_SUGAR_WORDS) || hasWord(item.name, SWEET_FRUIT_WORDS))) {
              offenders.push(`${plan.id} KETO ${recipe.id}: ${item.name}`);
            }
            if (profile.diet === Diet.PALEO && (type === IngredientType.GRAIN || type === IngredientType.DAIRY
              || hasWord(item.name, GRAIN_WORDS) || hasWord(item.name, LEGUME_WORDS) || hasWord(item.name, SUGAR_WORDS))) {
              offenders.push(`${plan.id} PALEO ${recipe.id}: ${item.name}`);
            }
          }
          if (profile.diet === Diet.KETO && recipe.nutritionalValues.carbs > 10) {
            offenders.push(`${plan.id} KETO ${recipe.id}: carbs ${recipe.nutritionalValues.carbs}`);
          }
        }
      }
    }
    expect(offenders.slice(0, 30)).toEqual([]);
  });

  it('transformShoppingList has no warnings and no null quantities for sampled plans', () => {
    const idx = index(full);
    const offenders: string[] = [];
    for (const plan of sample()) {
      const days = idx.daysByPlan.get(plan.id) ?? [];
      const shoppingPlan = {
        id: plan.id,
        version: 1,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        days: days.map((day) => ({
          meals: (idx.mealsByDay.get(day.id) ?? []).map((meal) => {
            const recipe = idx.recipesById.get(meal.recipeId)!;
            return { id: meal.id, recipeId: meal.recipeId, recipe: { id: recipe.id, ingredients: recipe.ingredients } };
          }),
        })),
      };
      const result = transformShoppingList(plan.startDate.toISOString().slice(0, 10), shoppingPlan);
      if (result.warnings.length > 0) offenders.push(`${plan.id}: ${JSON.stringify(result.warnings).slice(0, 200)}`);
      if (result.items.some((item) => item.quantity === null)) offenders.push(`${plan.id}: null quantity`);
    }
    expect(offenders.slice(0, 30)).toEqual([]);
  });
});
