import { RecipeCategory } from '@/generated/prisma/client';
import { normalizeProperties } from '@/utils/normalize-properties.util';
import { normalizeRecipeText, normalizeRecipeTitle, recipeFingerprint } from '../recipe-fingerprint.util';
import { findExcludedIngredient, findIngredientGroup, restrictionTexts } from './ingredient-dictionary';
import { RECIPE_VALIDATION_CONFIG as CONFIG } from './recipe-validation.config';
import {
  STAGE_BY_CODE,
  VALIDATION_STAGES,
  type RecipeDraft,
  type RecipeDraftNutritionalValues,
  type RecipeValidationContext,
  type ValidationError,
  type ValidationResult,
  type ValidationSummary,
  type ValidationWarning,
  type ValidationWarningCode,
} from './recipe-validation.types';

// Validador determinístico de una receta generada (NUT-74). Etapas: schema → normalize → ranges →
// profile → duplicates (el parseo es aparte, ver parse-generated-output.ts). La primera etapa con
// errores corta el pipeline, pero cada etapa junta todos sus errores. No tiene efectos: nunca escribe.

type Raw = Record<string, unknown>;
type MacroKey = 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber';

const MACRO_KEYS: MacroKey[] = ['calories', 'protein', 'carbs', 'fat', 'fiber'];
const REQUIRED_MACROS: MacroKey[] = ['calories', 'protein'];
const CATEGORIES = new Set<string>(Object.values(RecipeCategory));

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const hasNumber = (value: unknown) => typeof value === 'number' || hasText(value);
const cleanText = (value: string) => value.trim().replace(/\s+/g, ' ');
const missing = (field: string, message: string): ValidationError => ({ code: 'MISSING_FIELD', field, message });
const outOfRange = (field: string, message: string): ValidationError => ({ code: 'INVALID_RANGE', field, message });

// Los macros llegan como { calories, protein, ... } (catálogo) o { Calories, Protein, ... } (comida de Gemini).
function readField(source: Raw, key: string): unknown {
  return source[key] ?? source[key.charAt(0).toUpperCase() + key.slice(1)];
}

// "al gusto", "c/n"…: expresiones de la lista fija que se aceptan sin cantidad.
function noQuantityExpression(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = cleanText(normalizeRecipeText(value));
  return CONFIG.noQuantityExpressions.includes(normalized) ? normalized : null;
}

// Números, strings numéricos ("200", "0,5") y fracciones ("1/2", "1 1/2"). Cualquier otra cosa es NaN.
// "1.000" (punto seguido de exactamente 3 dígitos) es ambiguo (¿mil o uno?): también es NaN.
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  if (/^[1-9]\d*\.\d{3}$/.test(value.trim())) return Number.NaN;
  const text = value.trim().replace(',', '.');
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const fraction = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(text);
  if (fraction) return Number(fraction[1] ?? 0) + Number(fraction[2]) / Number(fraction[3]);
  return Number.NaN;
}

// 2 decimales: "1/3" se guarda 0.33, no 0.3333333333333333.
const roundQuantity = (value: number) => Math.round(value * 100) / 100;

function normalizeUnit(unit: string): string {
  const lower = cleanText(unit).toLowerCase();
  return CONFIG.unitAliases[lower] ?? lower;
}

// ---- Etapa schema: presencia y tipo básico ----

function checkSchema(input: Raw): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!hasText(input.title)) errors.push(missing('title', 'Title is required'));
  if (!hasText(input.description)) errors.push(missing('description', 'Description is required'));
  for (const field of ['prepMinutes', 'cookMinutes']) {
    if (!hasNumber(input[field])) errors.push(missing(field, `${field} is required`));
  }

  if (!Array.isArray(input.ingredients) || input.ingredients.length === 0) {
    errors.push(missing('ingredients', 'At least one ingredient is required'));
  } else {
    input.ingredients.forEach((ingredient, index) => {
      const field = `ingredients[${index}]`;
      if (!isObject(ingredient)) {
        errors.push(missing(field, 'Each ingredient must be an object'));
        return;
      }
      const withoutQuantity = noQuantityExpression(ingredient.quantity) ?? noQuantityExpression(ingredient.unit);
      if (!hasText(ingredient.name)) errors.push(missing(`${field}.name`, 'Ingredient name is required'));
      if (!withoutQuantity && !hasNumber(ingredient.quantity)) errors.push(missing(`${field}.quantity`, 'Ingredient quantity is required'));
      if (!withoutQuantity && !hasText(ingredient.unit)) errors.push(missing(`${field}.unit`, 'Ingredient unit is required'));
    });
  }

  if (Array.isArray(input.instructions)) {
    if (input.instructions.length === 0) errors.push(missing('instructions', 'At least one step is required'));
    input.instructions.forEach((step, index) => {
      if (!hasText(step)) errors.push(missing(`instructions[${index}]`, 'Steps cannot be empty'));
    });
  } else if (!hasText(input.instructions)) {
    errors.push(missing('instructions', 'At least one step is required'));
  }

  if (!isObject(input.nutritionalValues)) {
    errors.push(missing('nutritionalValues', 'Nutritional values are required'));
  } else {
    for (const key of REQUIRED_MACROS) {
      if (!hasNumber(readField(input.nutritionalValues, key))) {
        errors.push(missing(`nutritionalValues.${key}`, `${key} is required`));
      }
    }
  }

  if (input.categories !== undefined && input.categories !== null && !Array.isArray(input.categories)) {
    errors.push(missing('categories', 'Categories must be a list'));
  }
  return errors;
}

// ---- Etapa normalize: arma el draft por lista blanca (los campos de más se descartan) ----

function normalize(input: Raw): { draft: RecipeDraft; errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const ingredients = (input.ingredients as Raw[]).map((ingredient, index) => {
    const name = cleanText(ingredient.name as string);
    const expression = noQuantityExpression(ingredient.quantity)
      ?? (hasText(ingredient.quantity) || typeof ingredient.quantity === 'number' ? null : noQuantityExpression(ingredient.unit));
    if (expression) {
      warnings.push({
        code: 'NON_NUMERIC_QUANTITY',
        field: `ingredients[${index}].quantity`,
        message: `Ingredient "${name}" has no quantity (${expression})`,
      });
      const unit = hasText(ingredient.unit) ? normalizeUnit(ingredient.unit) : expression;
      return { name, quantity: null, unit };
    }
    return { name, quantity: roundQuantity(toNumber(ingredient.quantity)), unit: normalizeUnit(ingredient.unit as string) };
  });

  const rawCategories = Array.isArray(input.categories) ? input.categories : [];
  const categories: RecipeCategory[] = [];
  rawCategories.forEach((value, index) => {
    const category = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!CATEGORIES.has(category)) {
      errors.push({ code: 'UNSUPPORTED_CATEGORY', field: `categories[${index}]`, message: 'Unsupported recipe category' });
    } else if (!categories.includes(category as RecipeCategory)) {
      categories.push(category as RecipeCategory);
    }
  });

  const rawValues = input.nutritionalValues as Raw;
  const nutritionalValues = {} as RecipeDraftNutritionalValues;
  for (const key of MACRO_KEYS) {
    const value = readField(rawValues, key);
    if (value !== undefined && value !== null) nutritionalValues[key] = toNumber(value);
  }
  const description = readField(rawValues, 'description');
  if (hasText(description)) nutritionalValues.description = cleanText(description);

  const instructions = Array.isArray(input.instructions) ? (input.instructions as string[]) : [input.instructions as string];
  const draft: RecipeDraft = {
    title: cleanText(input.title as string),
    description: cleanText(input.description as string),
    prepMinutes: toNumber(input.prepMinutes),
    cookMinutes: toNumber(input.cookMinutes),
    ingredients,
    instructions: instructions.map(cleanText),
    categories,
    properties: normalizeProperties(Array.isArray(input.properties) ? input.properties : []),
    nutritionalValues,
    ...(hasText(input.mealTitle) ? { mealTitle: cleanText(input.mealTitle) } : {}),
  };
  return { draft, errors, warnings };
}

// ---- Etapa ranges ----

function checkRanges(draft: RecipeDraft): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const { min, max } = CONFIG.minutes;

  for (const field of ['prepMinutes', 'cookMinutes'] as const) {
    const value = draft[field];
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push(outOfRange(field, `${field} must be a whole number between ${min} and ${max}`));
    }
  }

  draft.ingredients.forEach((ingredient, index) => {
    if (ingredient.quantity !== null && !(Number.isFinite(ingredient.quantity) && ingredient.quantity > 0)) {
      errors.push(outOfRange(`ingredients[${index}].quantity`, 'Ingredient quantity must be a positive number'));
    }
  });

  let macrosValid = true;
  for (const key of MACRO_KEYS) {
    const value = draft.nutritionalValues[key];
    if (value !== undefined && !(Number.isFinite(value) && value >= 0)) {
      macrosValid = false;
      errors.push(outOfRange(`nutritionalValues.${key}`, `${key} must be a number greater than or equal to 0`));
    }
  }

  if (macrosValid) {
    const calorieCheck = checkCalories(draft.nutritionalValues);
    if (calorieCheck?.code === 'INVALID_RANGE') errors.push(calorieCheck as ValidationError);
    else if (calorieCheck) warnings.push(calorieCheck as ValidationWarning);
  }
  return { errors, warnings };
}

// Calorías contra 4·P + 4·C + 9·G (aprobado por el TL). Sin carbs o fat la regla no se aplica.
function checkCalories(values: RecipeDraftNutritionalValues): ValidationError | ValidationWarning | null {
  const field = 'nutritionalValues.calories';
  if (values.carbs === undefined || values.fat === undefined) {
    return { code: 'CALORIE_CHECK_SKIPPED', field, message: 'Calories could not be checked: carbs or fat are missing' };
  }

  const { kcalPerGram, okUpTo, warnUpTo } = CONFIG.calories;
  const expected = kcalPerGram.protein * values.protein + kcalPerGram.carbs * values.carbs + kcalPerGram.fat * values.fat;
  if (expected === 0) {
    return values.calories > 0 ? outOfRange(field, 'Calories do not match the macronutrients') : null;
  }

  const deviation = Math.abs(values.calories - expected) / expected;
  if (deviation > warnUpTo) return outOfRange(field, 'Calories do not match the macronutrients');
  if (deviation > okUpTo) return { code: 'CALORIE_MACRO_MISMATCH', field, message: 'Calories differ from the macronutrients' };
  return null;
}

// ---- Etapa profile ----

function checkProfile(draft: RecipeDraft, ctx: RecipeValidationContext): ValidationError[] {
  const errors: ValidationError[] = [];
  const texts = restrictionTexts({
    mealTitle: draft.mealTitle,
    title: draft.title,
    description: draft.description,
    nutritionDescription: draft.nutritionalValues.description,
    ingredients: draft.ingredients,
    instructions: draft.instructions,
  });

  for (const restriction of ctx.excludedIngredients) {
    const found = findExcludedIngredient(texts, [restriction]);
    if (found) {
      errors.push({ code: 'EXCLUDED_INGREDIENT', message: `Recipe contains an excluded ingredient: ${found}` });
    }
  }

  for (const category of draft.categories) {
    const groups = CONFIG.contradictions[category];
    const found = groups ? findIngredientGroup(texts, groups) : null;
    if (found) {
      errors.push({
        code: 'CONTRADICTORY_PREFERENCE',
        field: 'categories',
        message: `Category ${category} contradicts the recipe ingredients (${found})`,
      });
    }
  }
  return errors;
}

// ---- Etapa duplicates (huella de NUT-72) ----

function checkDuplicates(
  draft: RecipeDraft,
  ctx: RecipeValidationContext,
  batchFingerprints?: ReadonlyMap<string, number>,
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const fingerprint = recipeFingerprint(draft);
  const catalog = ctx.catalog ?? [];

  const existing = catalog.find(recipe => recipeFingerprint(recipe) === fingerprint);
  if (existing) {
    return {
      errors: [{
        code: 'DUPLICATE_RECIPE',
        message: 'An identical recipe already exists in the catalog',
        existingRecipeId: existing.id,
        normalizedRecipe: draft,
      }],
      warnings: [],
    };
  }

  const duplicateOfIndex = batchFingerprints?.get(fingerprint);
  if (duplicateOfIndex !== undefined) {
    return {
      errors: [{ code: 'DUPLICATE_RECIPE', message: 'The same recipe appears twice in this batch', duplicateOfIndex }],
      warnings: [],
    };
  }

  const title = normalizeRecipeTitle(draft.title);
  const sameTitle = catalog.filter(recipe => normalizeRecipeTitle(recipe.title) === title).map(recipe => recipe.id).sort();
  const warnings: ValidationWarning[] = sameTitle.length > 0
    ? [{ code: 'POTENTIAL_DUPLICATE', field: 'title', message: 'A recipe with the same title already exists', recipeIds: sameTitle }]
    : [];
  return { errors: [], warnings };
}

// ---- Pipeline ----

function runPipeline(input: unknown, ctx: RecipeValidationContext, batchFingerprints?: ReadonlyMap<string, number>): ValidationResult {
  if (!isObject(input)) {
    return { valid: false, errors: [{ code: 'MISSING_FIELD', message: 'Recipe must be an object' }] };
  }

  const schemaErrors = checkSchema(input);
  if (schemaErrors.length > 0) return { valid: false, errors: schemaErrors };

  const { draft, errors: normalizeErrors, warnings } = normalize(input);
  if (normalizeErrors.length > 0) return { valid: false, errors: normalizeErrors };

  const ranges = checkRanges(draft);
  if (ranges.errors.length > 0) return { valid: false, errors: ranges.errors };
  warnings.push(...ranges.warnings);

  const profileErrors = checkProfile(draft, ctx);
  if (profileErrors.length > 0) return { valid: false, errors: profileErrors };

  const duplicates = checkDuplicates(draft, ctx, batchFingerprints);
  if (duplicates.errors.length > 0) return { valid: false, errors: duplicates.errors };
  warnings.push(...duplicates.warnings);

  return { valid: true, normalizedRecipe: draft, warnings };
}

export function validateRecipe(input: unknown, ctx: RecipeValidationContext): ValidationResult {
  return runPipeline(input, ctx);
}

// Un resultado por receta: una inválida no afecta al resto. Además marca los duplicados dentro
// del lote (contra recetas anteriores válidas del mismo lote).
export function validateRecipes(inputs: readonly unknown[], ctx: RecipeValidationContext): ValidationResult[] {
  const batchFingerprints = new Map<string, number>();
  return inputs.map((input, index) => {
    const result = runPipeline(input, ctx, batchFingerprints);
    if (result.valid) batchFingerprints.set(recipeFingerprint(result.normalizedRecipe), index);
    return result;
  });
}

// Receta del catálogo a reutilizar (y el draft normalizado) si el único problema es un duplicado exacto (design D7).
export function reusableDuplicate(result: ValidationResult): { recipeId: string; normalizedRecipe: RecipeDraft } | null {
  if (result.valid || result.errors.length !== 1) return null;
  const [{ code, existingRecipeId, normalizedRecipe }] = result.errors;
  return code === 'DUPLICATE_RECIPE' && existingRecipeId && normalizedRecipe ? { recipeId: existingRecipeId, normalizedRecipe } : null;
}

export function reusableRecipeId(result: ValidationResult): string | null {
  return reusableDuplicate(result)?.recipeId ?? null;
}

const unique = <T>(values: T[]) => [...new Set(values)];

// validationSnapshot de NUT-75: la etapa más temprana que falló (o "passed") y los códigos únicos.
export function summarizeResults(results: readonly ValidationResult[]): ValidationSummary {
  const codes = unique(results.flatMap(result => (result.valid ? [] : result.errors.map(error => error.code))));
  const warnings = unique(results.flatMap(result => (result.valid ? result.warnings.map(warning => warning.code) : [])));
  const failedStages = new Set(codes.map(code => STAGE_BY_CODE[code]));
  const stage = VALIDATION_STAGES.find(candidate => failedStages.has(candidate)) ?? 'passed';
  return { stage, codes, warnings: warnings as ValidationWarningCode[] };
}

export function summarizeParseFailure(errors: readonly ValidationError[]): ValidationSummary {
  return { stage: 'parse', codes: unique(errors.map(error => error.code)), warnings: [] };
}
