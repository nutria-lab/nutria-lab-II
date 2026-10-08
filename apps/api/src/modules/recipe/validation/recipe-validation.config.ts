import { RecipeCategory } from '@/generated/prisma/client';
import type { IngredientGroup } from './ingredient-dictionary';


export const RECIPE_VALIDATION_CONFIG = {
  // prepMinutes y cookMinutes: enteros dentro de este rango.
  minutes: { min: 0, max: 1440 },

  // Calorías contra 4·P + 4·C + 9·G. Desvío relativo a las esperadas por macros.
  calories: {
    kcalPerGram: { protein: 4, carbs: 4, fat: 9 },
    okUpTo: 0.15, // hasta 15 %: OK
    warnUpTo: 0.35, // hasta 35 %: warning CALORIE_MACRO_MISMATCH; más: INVALID_RANGE
  },

  // Alias de unidades (después de pasar a minúsculas).
  unitAliases: { gr: 'g', grs: 'g', cc: 'ml' } as Record<string, string>,

  // Expresiones aceptadas sin cantidad (minúsculas, sin acentos): quantity null + NON_NUMERIC_QUANTITY.
  noQuantityExpressions: ['al gusto', 'a gusto', 'c/n', 'cantidad necesaria'] as string[],

  // Categoría declarada → grupos de ingredientes que la contradicen (CONTRADICTORY_PREFERENCE).
  contradictions: {
    [RecipeCategory.VEGETARIAN]: ['meat', 'fish', 'shellfish'],
    [RecipeCategory.VEGAN]: ['meat', 'fish', 'shellfish', 'dairy', 'egg', 'honey'],
    [RecipeCategory.GLUTEN_FREE]: ['gluten'],
    [RecipeCategory.DAIRY_FREE]: ['dairy'],
  } as Partial<Record<RecipeCategory, IngredientGroup[]>>,
} as const;
