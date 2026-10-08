import type { RecipeCategory } from '@/generated/prisma/client';

// Tipos del validador determinístico de recetas generadas (NUT-74).

export type ValidationErrorCode =
  | 'EMPTY_OUTPUT'
  | 'INVALID_JSON'
  | 'COUNT_MISMATCH'
  | 'MISSING_FIELD'
  | 'INVALID_RANGE'
  | 'UNSUPPORTED_CATEGORY'
  | 'EXCLUDED_INGREDIENT'
  | 'CONTRADICTORY_PREFERENCE'
  | 'DUPLICATE_RECIPE';

export type ValidationWarningCode =
  | 'CALORIE_MACRO_MISMATCH'
  | 'CALORIE_CHECK_SKIPPED'
  | 'NON_NUMERIC_QUANTITY'
  | 'POTENTIAL_DUPLICATE';

// Etapas del pipeline, en orden. La primera con errores corta el pipeline de esa receta.
export const VALIDATION_STAGES = ['parse', 'schema', 'normalize', 'ranges', 'profile', 'duplicates'] as const;
export type ValidationStage = (typeof VALIDATION_STAGES)[number];

// Cada código pertenece a una sola etapa, así el resultado no necesita un campo `stage`.
export const STAGE_BY_CODE: Record<ValidationErrorCode, ValidationStage> = {
  EMPTY_OUTPUT: 'parse',
  INVALID_JSON: 'parse',
  COUNT_MISMATCH: 'parse',
  MISSING_FIELD: 'schema',
  UNSUPPORTED_CATEGORY: 'normalize',
  INVALID_RANGE: 'ranges',
  EXCLUDED_INGREDIENT: 'profile',
  CONTRADICTORY_PREFERENCE: 'profile',
  DUPLICATE_RECIPE: 'duplicates',
};

// Los mensajes son para la UI: nunca incluyen el prompt, el texto generado completo ni un stack trace.
export interface ValidationError {
  code: ValidationErrorCode;
  field?: string;
  message: string;
  // Sólo DUPLICATE_RECIPE (única extensión al tipo del ticket, design D1):
  existingRecipeId?: string; // receta del catálogo que se reutiliza
  duplicateOfIndex?: number; // receta anterior del mismo lote
  normalizedRecipe?: RecipeDraft; // el draft ya normalizado, para que el que reutiliza valide con él
}

export interface ValidationWarning {
  code: ValidationWarningCode;
  field?: string;
  message: string;
  recipeIds?: string[]; // POTENTIAL_DUPLICATE
}

export interface RecipeDraftIngredient {
  name: string;
  quantity: number | null; // null: expresión sin cantidad de la lista fija ("al gusto")
  unit: string;
}

export interface RecipeDraftNutritionalValues {
  calories: number;
  protein: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  description?: string;
}

// Receta ya normalizada: lo único que se puede persistir.
export interface RecipeDraft {
  title: string;
  description: string;
  prepMinutes: number;
  cookMinutes: number;
  ingredients: RecipeDraftIngredient[];
  instructions: string[];
  categories: RecipeCategory[];
  properties: string[];
  nutritionalValues: RecipeDraftNutritionalValues;
  // Título de la comida que contiene la receta (plan semanal / reemplazo); también se revisa por restricciones.
  mealTitle?: string;
}

export type ValidationResult =
  | { valid: true; normalizedRecipe: RecipeDraft; warnings: ValidationWarning[] }
  | { valid: false; errors: ValidationError[] };

// Receta del catálogo con el mismo título normalizado que algún draft (búsqueda acotada, design D7).
export interface CatalogRecipeRef {
  id: string;
  title: string;
  ingredients: unknown;
}

export interface RecipeValidationContext {
  // Restricciones del perfil, en cualquier capitalización (ej.: ['NUTS', 'GLUTEN']).
  excludedIngredients: readonly string[];
  catalog?: readonly CatalogRecipeRef[];
}

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; errors: ValidationError[] };

// Lo que se guarda en GenerationRun.validationSnapshot (NUT-75).
export interface ValidationSummary {
  stage: ValidationStage | 'passed';
  codes: ValidationErrorCode[];
  warnings: ValidationWarningCode[];
}
