// NUT-114 — Generador puro del dataset sintético. Determinista: `now` llega inyectado, sin env, sin I/O,
// sin red y sin aleatoriedad. El seeder (Bloque 2) solo persiste lo que devuelve este módulo.
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
} from '../../src/generated/prisma/client';
import {
  ARROZ_INTEGRAL_SEED,
  PECHUGA_POLLO_SEED,
  synthId,
  syntheticEmail,
  syntheticName,
} from '../../src/prisma/seed-data';
import { mapRecipeNutritionToMeal } from '../../src/modules/plans/recipe-nutrition.mapper';
import { buildWeeklySlots } from '../../src/modules/plans/weekly-proposal-assignment';
import { transformShoppingList } from '../../src/modules/shopping-list/shopping-list.transform';
import type { ShoppingListPlan } from '../../src/modules/shopping-list/shopping-list.types';
import { dateInBuenosAires } from '../../src/modules/adherence/adherence.repository';
import {
  findExcludedIngredientInSource,
  profileForbiddenRestrictions,
} from '../../src/modules/recipe/validation/ingredient-dictionary';
import { RECIPE_VALIDATION_CONFIG } from '../../src/modules/recipe/validation/recipe-validation.config';
import {
  CURATED_INGREDIENTS,
  CURATED_RECIPES,
  CuratedIngredient,
  CuratedRecipeTemplate,
  NutritionPer100,
} from './catalog';

/** Texto buscado en dist/ para probar que el generador no se compila con la app. */
export const SYNTHETIC_GENERATOR_SENTINEL = 'nut114-synthetic-generator-sentinel';
export const SYNTHETIC_NO_LOGIN_HASH = '!synthetic-no-login';
export const PAST_PLAN_FIRST_MONDAY = '2026-01-05';
export const PAST_PLAN_WEEKS = 40;
export const MAX_SYNTHETIC_USERS = 5000;
/** Fecha fija y pasada (fuera de cualquier ventana KPI reciente); no depende de `now`. */
export const SYNTHETIC_RECIPE_CREATED_AT = '2025-12-01T12:00:00.000Z';

export type SyntheticGenerationErrorCode =
  | 'invalid_volume'
  | 'invalid_demo_hash'
  | 'ingredient_name_collision'
  | 'now_before_past_weeks';

export class SyntheticGenerationError extends Error {
  readonly code: SyntheticGenerationErrorCode;

  constructor(code: SyntheticGenerationErrorCode, message: string) {
    super(message);
    this.name = 'SyntheticGenerationError';
    this.code = code;
  }
}

// ---------- tipos del dataset ----------

export interface SyntheticIngredient {
  id: string;
  name: string;
  type: IngredientType;
  description: string;
  defaultUnit: string;
  nutritionalValues: NutritionPer100;
  properties: string[];
}

export interface SyntheticUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
}

export interface SyntheticProfile {
  id: string;
  userId: string;
  goal: NutritionGoal;
  diet: Diet;
  excludedIngredients: DietaryRestriction[];
  cookTimePreference: CookTimePreference;
}

export interface SyntheticRecipeIngredient {
  name: string;
  quantity: number;
  unit: string;
}

export interface SyntheticRecipe {
  id: string;
  title: string;
  description: string;
  prepMinutes: number;
  cookMinutes: number;
  categories: RecipeCategory[];
  ingredients: SyntheticRecipeIngredient[];
  instructions: string[];
  nutritionalValues: { calories: number; protein: number; fiber: number; carbs: number; fat: number };
  properties: string[];
  origin: 'MANUAL';
  createdAt: Date;
}

export interface SyntheticPlan {
  id: string;
  userId: string;
  startDate: Date;
  endDate: Date;
  isCurrent: true;
  version: 1;
}

export interface SyntheticDay {
  id: string;
  mealPlanId: string;
  day: DayOfWeek;
  date: Date;
}

export interface SyntheticMeal {
  id: string;
  dayId: string;
  mealType: MealType;
  title: string;
  recipeId: string;
  nutritionalValues: ReturnType<typeof mapRecipeNutritionToMeal>;
}

export interface SyntheticCompletion {
  id: string;
  userId: string;
  plannedMealId: string;
  recipeIdSnapshot: string;
  status: MealCompletionStatus;
}

export interface SyntheticShoppingCheck {
  id: string;
  userId: string;
  planId: string;
  itemKey: string;
  checked: boolean;
}

export interface SyntheticDataset {
  ingredients: SyntheticIngredient[];
  users: SyntheticUser[];
  profiles: SyntheticProfile[];
  recipes: SyntheticRecipe[];
  plans: SyntheticPlan[];
  days: SyntheticDay[];
  meals: SyntheticMeal[];
  completions: SyntheticCompletion[];
  shoppingChecks: SyntheticShoppingCheck[];
}

/** Forma mínima aceptada para un catálogo inyectado (CuratedIngredient la cumple). */
export interface CatalogIngredientInput {
  name: string;
  type: IngredientType;
  defaultUnit: string;
  nutritionalValues: NutritionPer100;
}

export interface GenerateOptions {
  users: number;
  demoPasswordHash: string;
  now: Date;
  catalog?: readonly CatalogIngredientInput[];
}

// ---------- utilidades ----------

const DAY_MS = 24 * 60 * 60 * 1000;
const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const MEAL_TYPES_IN_ORDER = [MealType.BREAKFAST, MealType.LUNCH, MealType.SNACK, MealType.DINNER];

const utcDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
const round1 = (value: number) => Math.round(value * 10) / 10;

/** NFKC -> NFD sin diacríticos -> minúsculas -> trim -> espacios colapsados. */
export function normalizeIngredientName(name: string): string {
  return name
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// ---------- ingredientes ----------

export type SyntheticUnit = 'g' | 'ml' | 'unidad';

/** Variante combinatoria (base × presentación × tamaño) de un ingrediente curado. */
export interface SyntheticIngredientVariant {
  baseName: string;
  presentation: string;
  unit: SyntheticUnit;
  /** Tamaño del envase expresado en `unit`; null solo si el nombre no trae tamaño. */
  packageSize: { quantity: number; unit: SyntheticUnit } | null;
}

const PRESENTATIONS = [
  'a granel', 'en bandeja', 'en bolsa', 'en frasco', 'en lata',
  'en caja', 'en conserva', 'de cultivo local', 'de producción orgánica', 'premium',
];

interface SizeOption {
  label: string;
  /** Cantidad en la unidad base de la familia (g, ml o unidad). */
  quantity: number;
}

const sizes = (list: Array<[string, number]>): SizeOption[] => list.map(([label, quantity]) => ({ label, quantity }));
const SIZES: Record<string, SizeOption[]> = {
  g: sizes([['100 g', 100], ['200 g', 200], ['250 g', 250], ['400 g', 400], ['500 g', 500], ['750 g', 750], ['1 kg', 1000], ['2 kg', 2000], ['5 kg', 5000]]),
  ml: sizes([['200 ml', 200], ['250 ml', 250], ['500 ml', 500], ['750 ml', 750], ['1 l', 1000], ['1,5 l', 1500], ['2 l', 2000], ['5 l', 5000], ['10 l', 10000]]),
  unidad: sizes([['x 1 unidad', 1], ['x 2 unidades', 2], ['x 3 unidades', 3], ['x 4 unidades', 4], ['x 6 unidades', 6], ['x 10 unidades', 10], ['x 12 unidades', 12], ['x 24 unidades', 24], ['x 30 unidades', 30]]),
};

/** Orden de primera aparición de cada ingrediente en las plantillas de recetas. */
const TEMPLATE_INGREDIENT_RANK: ReadonlyMap<string, number> = (() => {
  const rank = new Map<string, number>();
  for (const template of CURATED_RECIPES) for (const [name] of template.ingredients) if (!rank.has(name)) rank.set(name, rank.size);
  return rank;
})();

/**
 * Catálogo ordenado por primera aparición en las plantillas (los no usados al final, en su orden original): con
 * volúmenes chicos la tabla de ingredientes contiene primero los que usan las primeras recetas.
 */
function catalogByTemplateUse<T extends { name: string }>(catalog: readonly T[]): T[] {
  const rankOf = (name: string) => TEMPLATE_INGREDIENT_RANK.get(name) ?? Number.MAX_SAFE_INTEGER;
  return catalog
    .map((ingredient, index) => ({ ingredient, index }))
    .sort((a, b) => rankOf(a.ingredient.name) - rankOf(b.ingredient.name) || a.index - b.index)
    .map(({ ingredient }) => ingredient);
}

interface VariantCandidate<T> {
  base: T;
  presentation: string;
  size: SizeOption;
  name: string;
}

/**
 * Nombres combinatorios en orden tamaño -> presentación -> base. Solo derivan de bases que alguna plantilla usa
 * (así toda variante puede aparecer en una receta); si ninguna base del catálogo se usa, derivan de todo el catálogo.
 */
function* variantCandidates<T extends CatalogIngredientInput>(catalog: readonly T[]): Generator<VariantCandidate<T>> {
  const used = catalog.filter((ingredient) => TEMPLATE_INGREDIENT_RANK.has(ingredient.name));
  const bases = used.length > 0 ? used : catalog;
  const maxSizes = Math.max(...Object.values(SIZES).map((list) => list.length));
  for (let s = 0; s < maxSizes; s += 1) {
    for (const presentation of PRESENTATIONS) {
      for (const base of bases) {
        const size = (SIZES[base.defaultUnit] ?? SIZES.g)[s];
        if (!size) continue;
        yield { base, presentation, size, name: `${base.name} ${presentation} ${size.label}` };
      }
    }
  }
}

let variantIndex: Map<string, SyntheticIngredientVariant> | null = null;

/** Describe un nombre combinatorio del catálogo por defecto; null para nombres curados o que el generador no produce. */
export function describeSyntheticIngredient(name: string): SyntheticIngredientVariant | null {
  if (!variantIndex) {
    variantIndex = new Map();
    for (const { base, presentation, size, name: variantName } of variantCandidates(CURATED_INGREDIENTS)) {
      variantIndex.set(variantName, {
        baseName: base.name,
        presentation,
        unit: base.defaultUnit,
        packageSize: { quantity: size.quantity, unit: base.defaultUnit },
      });
    }
  }
  const variant = variantIndex.get(name);
  return variant ? { ...variant, packageSize: variant.packageSize && { ...variant.packageSize } } : null;
}

/** Filas combinatorias de la tabla de ingredientes y cuántas aparecen en al menos una receta. */
export function combinatorialUsage(dataset: {
  ingredients: ReadonlyArray<{ name: string }>;
  recipes: ReadonlyArray<{ ingredients: ReadonlyArray<{ name: string }> }>;
}): { total: number; used: number; percent: number } {
  const referenced = new Set(dataset.recipes.flatMap((recipe) => recipe.ingredients.map((item) => item.name)));
  const combinatorial = dataset.ingredients.filter((ingredient) => describeSyntheticIngredient(ingredient.name) !== null);
  const total = combinatorial.length;
  const used = combinatorial.filter((ingredient) => referenced.has(ingredient.name)).length;
  return { total, used, percent: total === 0 ? 0 : (used / total) * 100 };
}

function curatedToSynthetic(ingredient: CatalogIngredientInput, name: string, index: number, description: string): SyntheticIngredient {
  return {
    id: synthId('ingredients', index + 1),
    name,
    type: ingredient.type,
    description,
    defaultUnit: ingredient.defaultUnit,
    nutritionalValues: { ...ingredient.nutritionalValues },
    properties: ['Dato sintético'],
  };
}

/** Catálogo primero, después nombres combinatorios base × presentación × tamaño. */
export function buildIngredients(opts: { count: number; catalog?: readonly CatalogIngredientInput[] }): SyntheticIngredient[] {
  const catalog: readonly CatalogIngredientInput[] = opts.catalog ?? CURATED_INGREDIENTS;
  const seen = new Set([normalizeIngredientName(PECHUGA_POLLO_SEED.name), normalizeIngredientName(ARROZ_INTEGRAL_SEED.name)]);
  const claim = (name: string) => {
    const normalized = normalizeIngredientName(name);
    if (seen.has(normalized)) {
      throw new SyntheticGenerationError('ingredient_name_collision', `Nombre de ingrediente repetido: "${normalized}".`);
    }
    seen.add(normalized);
  };

  // Todo el catálogo se valida aunque `count` sea menor.
  catalog.forEach((ingredient) => claim(ingredient.name));

  const result: SyntheticIngredient[] = [];
  for (const ingredient of catalogByTemplateUse(catalog)) {
    if (result.length >= opts.count) return result;
    result.push(curatedToSynthetic(ingredient, ingredient.name, result.length, `${ingredient.name}: ingrediente del catálogo sintético.`));
  }

  // Recorre tamaño -> presentación -> base para repartir las variantes entre todos los ingredientes base.
  for (const { base, name } of variantCandidates(catalog)) {
    if (result.length >= opts.count) return result;
    claim(name);
    result.push(curatedToSynthetic(base, name, result.length, `Presentación comercial sintética de ${base.name}.`));
  }

  if (result.length < opts.count) {
    throw new SyntheticGenerationError('invalid_volume', 'El catálogo no alcanza para generar la cantidad pedida de ingredientes.');
  }
  return result;
}

// ---------- usuarios y perfiles ----------

const DIETS: Diet[] = [Diet.ALL, Diet.VEGETARIAN, Diet.VEGAN, Diet.PESCATARIAN, Diet.KETO, Diet.PALEO];
const GOALS: NutritionGoal[] = [NutritionGoal.MAINTAIN, NutritionGoal.LOSE_WEIGHT, NutritionGoal.GAIN_MUSCLE];
const COOK_TIMES: CookTimePreference[] = [CookTimePreference.STANDARD, CookTimePreference.QUICK, CookTimePreference.GOURMET];

function restrictionsFor(n: number): DietaryRestriction[] {
  const result: DietaryRestriction[] = [];
  if (n % 9 === 2) result.push(DietaryRestriction.NUTS);
  if (n % 4 === 0) result.push(DietaryRestriction.GLUTEN);
  if (n % 7 === 3) result.push(DietaryRestriction.DAIRY);
  if (n % 13 === 6) result.push(DietaryRestriction.SHELLFISH);
  if (n % 11 === 5) result.push(DietaryRestriction.SOY);
  return result;
}

function buildUsers(count: number, demoPasswordHash: string): SyntheticUser[] {
  return Array.from({ length: count }, (_, i) => ({
    id: synthId('users', i + 1),
    email: syntheticEmail(i + 1),
    name: syntheticName(i + 1),
    passwordHash: i === 0 ? demoPasswordHash : SYNTHETIC_NO_LOGIN_HASH,
  }));
}

function buildProfiles(users: SyntheticUser[]): SyntheticProfile[] {
  return users.map((user, i) => {
    const n = i + 1;
    return {
      id: synthId('profiles', n),
      userId: user.id,
      goal: GOALS[Math.floor(i / DIETS.length) % GOALS.length],
      diet: DIETS[i % DIETS.length],
      excludedIngredients: restrictionsFor(n),
      cookTimePreference: COOK_TIMES[i % COOK_TIMES.length],
    };
  });
}

// ---------- recetas ----------

const CURATED_BY_NAME = new Map(CURATED_INGREDIENTS.map((ingredient) => [ingredient.name, ingredient]));

const CATEGORY_PROPERTIES: Record<RecipeCategory, string> = {
  VEGAN: 'Vegano',
  VEGETARIAN: 'Vegetariano',
  HIGH_PROTEIN: 'Alto en Proteína',
  GLUTEN_FREE: 'Sin Gluten',
  DAIRY_FREE: 'Sin Lácteos',
  LOW_CARB: 'Bajo en Carbohidratos',
  OTHER: 'Otro',
};

function curatedIngredient(name: string): CuratedIngredient {
  const ingredient = CURATED_BY_NAME.get(name);
  if (!ingredient) throw new Error(`Plantilla de receta con ingrediente fuera del catálogo: ${name}`);
  return ingredient;
}

function templateNutrition(template: CuratedRecipeTemplate): SyntheticRecipe['nutritionalValues'] {
  const total = { calories: 0, protein: 0, fiber: 0, carbs: 0, fat: 0 };
  for (const [name, quantity] of template.ingredients) {
    const ingredient = curatedIngredient(name);
    const factor = ingredient.defaultUnit === 'unidad' ? quantity : quantity / 100;
    for (const key of Object.keys(total) as Array<keyof typeof total>) {
      total[key] += ingredient.nutritionalValues[key] * factor;
    }
  }
  return {
    calories: Math.round(total.calories),
    protein: round1(total.protein),
    fiber: round1(total.fiber),
    carbs: round1(total.carbs),
    fat: round1(total.fat),
  };
}

function deriveCategories(recipe: Pick<SyntheticRecipe, 'title' | 'description' | 'ingredients' | 'instructions' | 'nutritionalValues'>): RecipeCategory[] {
  const categories: RecipeCategory[] = [];
  const contradictions = RECIPE_VALIDATION_CONFIG.contradictions;
  for (const category of [RecipeCategory.VEGAN, RecipeCategory.VEGETARIAN] as const) {
    if (findExcludedIngredientInSource(recipe, contradictions[category] ?? []) === null) categories.push(category);
  }
  if (recipe.nutritionalValues.protein >= 20) categories.push(RecipeCategory.HIGH_PROTEIN);
  for (const category of [RecipeCategory.GLUTEN_FREE, RecipeCategory.DAIRY_FREE] as const) {
    if (findExcludedIngredientInSource(recipe, contradictions[category] ?? []) === null) categories.push(category);
  }
  if (recipe.nutritionalValues.carbs <= 10) categories.push(RecipeCategory.LOW_CARB);
  return categories.length > 0 ? categories : [RecipeCategory.OTHER];
}

function recipeContent(template: CuratedRecipeTemplate) {
  const ingredients = template.ingredients.map(([name, quantity]) =>
    ({ name, quantity, unit: curatedIngredient(name).defaultUnit }));
  const names = ingredients.map((item) => item.name.toLowerCase()).join(', ');
  const content = {
    title: template.title,
    description: template.description,
    ingredients,
    instructions: [`Preparar los ingredientes: ${names}.`, template.method, 'Servir en el momento.'],
    nutritionalValues: templateNutrition(template),
  };
  return { ...content, categories: deriveCategories(content) };
}

const templateContents = new Map<number, ReturnType<typeof recipeContent>>();
/** Contenido curado (nombres del catálogo) de la plantilla `t`, memoizado. */
function templateContent(t: number): ReturnType<typeof recipeContent> {
  let content = templateContents.get(t);
  if (!content) {
    content = recipeContent(CURATED_RECIPES[t]);
    templateContents.set(t, content);
  }
  return content;
}

const TEMPLATE_BY_TITLE = new Map(CURATED_RECIPES.map((template, t) => [template.title, t]));
const VARIANT_TITLE_SUFFIX = / \(variante \d+\)$/;

function templateIndexOf(recipe: Pick<SyntheticRecipe, 'title'>): number {
  const t = TEMPLATE_BY_TITLE.get(recipe.title.replace(VARIANT_TITLE_SUFFIX, ''));
  if (t === undefined) throw new Error(`Receta sintética sin plantilla: ${recipe.title}`);
  return t;
}

/**
 * Ciclo 0 = plantillas con nombres curados. Ciclos siguientes = misma plantilla con cada ingrediente reemplazado por
 * la siguiente variante combinatoria de su base presente en la tabla (round-robin por base). Las variantes clasifican
 * igual que su base y comparten sus valores por unidad, así que nutrición, categorías e instrucciones (con los nombres
 * base) se conservan. Solo se usan plantillas cuyos ingredientes curados estén todos en la tabla (volúmenes chicos).
 */
function buildRecipes(count: number, table: readonly SyntheticIngredient[]): SyntheticRecipe[] {
  const available = new Set(table.map((ingredient) => ingredient.name));
  const variantsByBase = new Map<string, string[]>();
  for (const { name } of table) {
    const variant = describeSyntheticIngredient(name);
    if (variant) variantsByBase.set(variant.baseName, [...(variantsByBase.get(variant.baseName) ?? []), name]);
  }
  const all = CURATED_RECIPES.map((_, t) => t);
  const fitting = all.filter((t) => CURATED_RECIPES[t].ingredients.every(([name]) => available.has(name)));
  const templates = fitting.length > 0 ? fitting : all;
  const nextVariant = new Map<string, number>();
  const variantOf = (baseName: string) => {
    const list = variantsByBase.get(baseName);
    if (!list) return baseName;
    const k = nextVariant.get(baseName) ?? 0;
    nextVariant.set(baseName, k + 1);
    return list[k % list.length];
  };

  return Array.from({ length: count }, (_, i) => {
    const template = CURATED_RECIPES[templates[i % templates.length]];
    const content = templateContent(templates[i % templates.length]);
    const cycle = Math.floor(i / templates.length);
    return {
      id: synthId('recipes', i + 1),
      title: cycle === 0 ? template.title : `${template.title} (variante ${cycle + 1})`,
      description: content.description,
      prepMinutes: template.prepMinutes,
      cookMinutes: template.cookMinutes,
      categories: [...content.categories],
      ingredients: content.ingredients.map((item) => ({ ...item, name: cycle === 0 ? item.name : variantOf(item.name) })),
      instructions: [...content.instructions],
      nutritionalValues: { ...content.nutritionalValues },
      properties: content.categories.filter((c) => c !== RecipeCategory.OTHER).map((c) => CATEGORY_PROPERTIES[c]),
      origin: 'MANUAL' as const,
      createdAt: new Date(SYNTHETIC_RECIPE_CREATED_AT),
    };
  });
}

// ---------- compatibilidad dieta / restricciones ----------

type ProfileLike = Pick<SyntheticProfile, 'diet' | 'excludedIngredients'>;

type CompatibilitySource = Pick<SyntheticRecipe, 'ingredients' | 'nutritionalValues'>;

const hasTypeOrTag = (recipe: CompatibilitySource, types: IngredientType[], tags: string[]) =>
  recipe.ingredients.some(({ name }) => {
    const ingredient = curatedIngredient(name);
    return types.includes(ingredient.type) || (ingredient.tags ?? []).some((tag) => tags.includes(tag));
  });

/** Grupos (dominio + regla propia KETO/PALEO) que la receta no puede mencionar para este perfil. */
function forbiddenGroupsFor(profile: ProfileLike): string[] {
  const groups = new Set(profileForbiddenRestrictions(profile));
  if (profile.diet === Diet.KETO) ['gluten', 'honey'].forEach((group) => groups.add(group));
  if (profile.diet === Diet.PALEO) ['gluten', 'dairy'].forEach((group) => groups.add(group));
  return [...groups];
}

/**
 * Regla del dominio (profileForbiddenRestrictions + findExcludedIngredientInSource) y, como el dominio no define
 * política para KETO/PALEO, una regla propia del seed:
 *   KETO  = ≤ 10 g de carbohidratos por porción, sin granos, azúcar/miel ni frutas dulces.
 *   PALEO = sin granos, lácteos, legumbres ni azúcar agregada.
 * `mentions(group)` equivale a findExcludedIngredientInSource(recipe, [group]) !== null (el oráculo evalúa cada
 * grupo por separado, así que se puede memoizar por grupo).
 */
function isRecipeCompatible(recipe: CompatibilitySource, profile: ProfileLike, mentions: (group: string) => boolean): boolean {
  if (forbiddenGroupsFor(profile).some(mentions)) return false;
  if (profile.diet === Diet.KETO) {
    return recipe.nutritionalValues.carbs <= 10
      && !hasTypeOrTag(recipe, [IngredientType.GRAIN], ['sugar', 'sweetFruit']);
  }
  if (profile.diet === Diet.PALEO) {
    return !hasTypeOrTag(recipe, [IngredientType.GRAIN, IngredientType.DAIRY], ['legume', 'sugar']);
  }
  return true;
}

const profileKey = (profile: ProfileLike) => `${profile.diet}|${[...profile.excludedIngredients].sort().join(',')}`;

/** Índices de recetas compatibles por tipo de comida; si un tipo no tiene ninguna, cae a cualquier compatible. */
function createCandidateIndex(recipes: SyntheticRecipe[]) {
  const templateOf = recipes.map(templateIndexOf);
  const cache = new Map<string, Map<MealType, number[]>>();
  const mentionCache = new Map<string, boolean>();
  const mentionsFor = (t: number) => (group: string) => {
    const key = `${t}|${group}`;
    let value = mentionCache.get(key);
    if (value === undefined) {
      value = findExcludedIngredientInSource(templateContent(t), [group]) !== null;
      mentionCache.set(key, value);
    }
    return value;
  };
  return (profile: ProfileLike): Map<MealType, number[]> => {
    const key = profileKey(profile);
    const cached = cache.get(key);
    if (cached) return cached;
    // Las variantes cambian el título ("(variante k)") y los nombres por variantes que clasifican igual que su base:
    // la compatibilidad se decide por plantilla.
    const compatibleTemplate = new Map<number, boolean>();
    const isCompatible = (t: number) => {
      let value = compatibleTemplate.get(t);
      if (value === undefined) {
        value = isRecipeCompatible(templateContent(t), profile, mentionsFor(t));
        compatibleTemplate.set(t, value);
      }
      return value;
    };
    const byMeal = new Map<MealType, number[]>(MEAL_TYPES_IN_ORDER.map((mealType) => [mealType, []]));
    const any: number[] = [];
    recipes.forEach((_, index) => {
      const t = templateOf[index];
      if (!isCompatible(t)) return;
      any.push(index);
      byMeal.get(CURATED_RECIPES[t].mealType)!.push(index);
    });
    if (any.length === 0) throw new Error(`No hay recetas sintéticas compatibles con el perfil ${key}`);
    for (const mealType of MEAL_TYPES_IN_ORDER) if (byMeal.get(mealType)!.length === 0) byMeal.set(mealType, any);
    cache.set(key, byMeal);
    return byMeal;
  };
}

// ---------- planes ----------

interface WeekRows {
  plan: SyntheticPlan;
  days: SyntheticDay[];
  meals: SyntheticMeal[];
}

function buildWeek(opts: {
  planId: string;
  userId: string;
  monday: Date;
  dayId: (d: number) => string;
  mealId: (d: number, m: number) => string;
  pick: (d: number, mealType: MealType) => SyntheticRecipe;
  mealNutrition: (recipe: SyntheticRecipe) => SyntheticMeal['nutritionalValues'];
}): WeekRows {
  const plan: SyntheticPlan = {
    id: opts.planId,
    userId: opts.userId,
    startDate: new Date(opts.monday),
    endDate: addDays(opts.monday, 6),
    isCurrent: true,
    version: 1,
  };
  const days: SyntheticDay[] = [];
  const meals: SyntheticMeal[] = [];
  buildWeeklySlots(opts.monday).forEach((slot, k) => {
    const d = Math.floor(k / 4);
    const m = k % 4;
    if (m === 0) days.push({ id: opts.dayId(d), mealPlanId: plan.id, day: slot.day, date: utcDate(slot.date) });
    const recipe = opts.pick(d, slot.mealType);
    meals.push({
      id: opts.mealId(d, m),
      dayId: days[d].id,
      mealType: slot.mealType,
      title: recipe.title,
      recipeId: recipe.id,
      nutritionalValues: opts.mealNutrition(recipe),
    });
  });
  return { plan, days, meals };
}

function shoppingPlanOf(week: WeekRows, recipesById: Map<string, SyntheticRecipe>): NonNullable<ShoppingListPlan> {
  return {
    id: week.plan.id,
    version: week.plan.version,
    updatedAt: week.plan.startDate,
    days: week.days.map((day) => ({
      meals: week.meals.filter((meal) => meal.dayId === day.id).map((meal) => {
        const recipe = recipesById.get(meal.recipeId)!;
        return { id: meal.id, recipeId: meal.recipeId, recipe: { id: recipe.id, ingredients: recipe.ingredients } };
      }),
    })),
  };
}

// 28 posiciones (día × B/L/S/D) de un plan pasado de un usuario activo: 14 COMPLETED, 4 SKIPPED, 2 NOT_LOGGED, 8 sin fila.
const C = MealCompletionStatus.COMPLETED;
const S = MealCompletionStatus.SKIPPED;
const N = MealCompletionStatus.NOT_LOGGED;
const PAST_COMPLETION_PATTERN: Array<MealCompletionStatus | null> = [
  C, C, S, null,
  C, N, C, null,
  C, C, C, null,
  C, S, C, null,
  C, C, S, null,
  C, N, null, null,
  C, S, C, null,
];
const ACTIVE_USER_STRIDE = 20;

// ---------- dataset completo ----------

export function generateSyntheticDataset(opts: GenerateOptions): SyntheticDataset {
  const { users: count, demoPasswordHash, now } = opts;
  if (!Number.isInteger(count) || count < 1 || count > MAX_SYNTHETIC_USERS) {
    throw new SyntheticGenerationError('invalid_volume', `users debe ser un entero entre 1 y ${MAX_SYNTHETIC_USERS}.`);
  }
  if (typeof demoPasswordHash !== 'string' || !BCRYPT_HASH.test(demoPasswordHash)) {
    throw new SyntheticGenerationError('invalid_demo_hash', 'El hash de la cuenta demo debe ser un hash bcrypt.');
  }
  const lastPastSunday = isoDay(addDays(utcDate(PAST_PLAN_FIRST_MONDAY), (PAST_PLAN_WEEKS - 1) * 7 + 6));
  if (!(now instanceof Date) || Number.isNaN(now.getTime()) || !(lastPastSunday < dateInBuenosAires(now))) {
    throw new SyntheticGenerationError('now_before_past_weeks', `now debe ser posterior a ${lastPastSunday} (hora de Buenos Aires).`);
  }

  const ingredients = buildIngredients({ count, catalog: opts.catalog });
  const users = buildUsers(count, demoPasswordHash);
  const profiles = buildProfiles(users);
  const recipes = buildRecipes(count, ingredients);
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const nutritionByRecipe = new Map(recipes.map((recipe) => [recipe.id, mapRecipeNutritionToMeal(recipe)]));
  const candidatesFor = createCandidateIndex(recipes);
  const firstMonday = utcDate(PAST_PLAN_FIRST_MONDAY);

  const plans: SyntheticPlan[] = [];
  const days: SyntheticDay[] = [];
  const meals: SyntheticMeal[] = [];
  const completions: SyntheticCompletion[] = [];
  const shoppingChecks: SyntheticShoppingCheck[] = [];

  users.forEach((user, i) => {
    const n = i + 1;
    const candidates = candidatesFor(profiles[i]);
    const week = buildWeek({
      planId: synthId('mealPlans', n),
      userId: user.id,
      monday: addDays(firstMonday, (i % PAST_PLAN_WEEKS) * 7),
      dayId: (d) => synthId('days', i * 7 + d + 1),
      mealId: (d, m) => synthId('meals', i * 28 + d * 4 + m + 1),
      pick: (d, mealType) => {
        const list = candidates.get(mealType)!;
        return recipes[list[(i * 7 + d) % list.length]];
      },
      mealNutrition: (recipe) => nutritionByRecipe.get(recipe.id)!,
    });
    plans.push(week.plan);
    days.push(...week.days);
    meals.push(...week.meals);

    if (i % ACTIVE_USER_STRIDE === 0) {
      week.meals.forEach((meal, k) => {
        const status = PAST_COMPLETION_PATTERN[k];
        if (!status) return;
        completions.push({
          id: synthId('completions', completions.length + 1),
          userId: user.id,
          plannedMealId: meal.id,
          recipeIdSnapshot: meal.recipeId,
          status,
        });
      });
    }

    const items = transformShoppingList(isoDay(week.plan.startDate), shoppingPlanOf(week, recipesById)).items;
    if (items.length > 0) {
      shoppingChecks.push({
        id: synthId('shoppingChecks', n),
        userId: user.id,
        planId: week.plan.id,
        itemKey: items[i % items.length].key,
        checked: i % 2 === 0,
      });
    }
  });

  return { ingredients, users, profiles, recipes, plans, days, meals, completions, shoppingChecks };
}

// ---------- semana actual de la cuenta 00001 ----------

/** Lunes (YYYY-MM-DD) de la semana civil de Buenos Aires que contiene `now`. */
export function currentWeekMonday(now: Date): string {
  const today = utcDate(dateInBuenosAires(now));
  return isoDay(addDays(today, -((today.getUTCDay() + 6) % 7)));
}

const compactDate = (iso: string) => iso.replace(/-/g, '');
/** Segmento final reservado para la semana actual: 9YYYYMMDD + 3 dígitos. */
const currentWeekIndex = (monday: string, suffix: string) => Number(`9${compactDate(monday)}${suffix}`);

export function buildCurrentWeek(opts: { now: Date; dataset: Pick<SyntheticDataset, 'users' | 'profiles' | 'recipes'> }): {
  monday: string;
  plan: SyntheticPlan;
  days: SyntheticDay[];
  meals: SyntheticMeal[];
} {
  const { dataset } = opts;
  const monday = currentWeekMonday(opts.now);
  const user = dataset.users[0];
  const profile = dataset.profiles.find((p) => p.userId === user.id)!;
  // La cuenta de recorrido usa solo recetas con nombres del catálogo curado (sin variantes combinatorias).
  const usesOnlyCurated = (recipe: SyntheticRecipe) => recipe.ingredients.every((item) => CURATED_BY_NAME.has(item.name));
  const candidates = new Map([...createCandidateIndex(dataset.recipes)(profile)].map(([mealType, list]) => {
    const curated = list.filter((index) => usesOnlyCurated(dataset.recipes[index]));
    return [mealType, curated.length > 0 ? curated : list];
  }));
  const week = buildWeek({
    planId: synthId('mealPlans', currentWeekIndex(monday, '000')),
    userId: user.id,
    monday: utcDate(monday),
    dayId: (d) => synthId('days', currentWeekIndex(monday, `00${d}`)),
    mealId: (d, m) => synthId('meals', currentWeekIndex(monday, `0${d}${m}`)),
    pick: (d, mealType) => {
      const list = candidates.get(mealType)!;
      return dataset.recipes[list[(d + 3) % list.length]];
    },
    mealNutrition: (recipe) => mapRecipeNutritionToMeal(recipe),
  });
  return { monday, ...week };
}

// Patrón fijo por día (B/L/S/D) de la semana actual, independiente de `now`. Lunes y martes los usa el test KPI.
const CURRENT_WEEK_PATTERN: Array<Array<MealCompletionStatus | null>> = [
  [C, C, S, null],
  [C, N, C, null],
  [C, S, null, null],
  [C, C, null, S],
  [S, C, C, null],
  [C, null, N, null],
  [C, C, null, null],
];

export function buildCurrentWeekCompletions(opts: {
  now: Date;
  userId: string;
  days: Array<{ id: string; date: Date }>;
  meals: Array<{ id: string; dayId: string; recipeId: string | null; updatedAt: Date }>;
}): Array<{
  id: string;
  userId: string;
  plannedMealId: string;
  recipeIdSnapshot: string | null;
  mealUpdatedAtSnapshot: Date;
  status: MealCompletionStatus;
}> {
  const today = dateInBuenosAires(opts.now);
  return opts.days.flatMap((day, d) => {
    if (!(isoDay(day.date) < today)) return [];
    const pattern = CURRENT_WEEK_PATTERN[d % CURRENT_WEEK_PATTERN.length];
    return opts.meals
      .filter((meal) => meal.dayId === day.id)
      .flatMap((meal, m) => {
        const status = pattern[m];
        if (!status) return [];
        return [{
          id: `5eed0008-0000-4000-8000-${meal.id.slice(-12)}`,
          userId: opts.userId,
          plannedMealId: meal.id,
          recipeIdSnapshot: meal.recipeId,
          mealUpdatedAtSnapshot: new Date(meal.updatedAt.getTime()),
          status,
        }];
      });
  });
}

export function buildCurrentWeekShoppingChecks(opts: {
  monday: string;
  userId: string;
  plan: NonNullable<ShoppingListPlan>;
}): SyntheticShoppingCheck[] {
  const items = transformShoppingList(opts.monday, opts.plan).items;
  if (items.length > 1000) throw new RangeError('La semana actual tiene más de 1000 ítems de compra.');
  return items.map((item, i) => ({
    id: synthId('shoppingChecks', currentWeekIndex(opts.monday, String(i).padStart(3, '0'))),
    userId: opts.userId,
    planId: opts.plan.id,
    itemKey: item.key,
    checked: i % 2 === 0,
  }));
}
