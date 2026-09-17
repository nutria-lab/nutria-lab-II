import { describe, expect, it } from 'vitest';

import { INGREDIENT_TYPE_LABELS, RECIPE_CATEGORY_LABELS } from './labels';
import type { RecipeCategory } from '../../services/recipeService';
import type { IngredientType } from '../../services/ingredientService';

// NUT-20 (décima iteración de tester — corrección de UX pedida directamente por la PO):
// `apps/web/src/modules/recipes/labels.ts` todavía NO EXISTE. Hoy toda la UI de recetas
// muestra el valor RAW del enum (`RecipeCategory`/`IngredientType`) en inglés/mayúsculas en
// vez de una etiqueta legible en español — la PO pidió explícitamente que se corrija, no
// puede quedar así en producción (ver design.md, sección de contrato de tipos, y el ticket
// NUT-61 para el origen exacto de ambos enums). Se espera ROJO hoy por módulo inexistente.
//
// Este módulo es la única fuente de verdad de la traducción: dos `Record<Enum, string>`
// exhaustivos (ni de más ni de menos claves que el enum real), consumidos por
// `RecipeCatalogList.tsx` (chips de filtro y badge de categoría), `RecipeForm.tsx` (chips de
// selección de categorías), `IngredientForm.tsx` (opciones del `<select>` de tipo) y
// `RecipeDetailPage.tsx` (badge de categoría del detalle). En todos esos lugares el VALOR
// interno que se envía/persiste sigue siendo el enum crudo — sólo cambia lo que se ve en
// pantalla (ver los tests actualizados de cada componente para esa distinción).

const RECIPE_CATEGORY_KEYS: RecipeCategory[] = [
  'VEGAN',
  'VEGETARIAN',
  'HIGH_PROTEIN',
  'GLUTEN_FREE',
  'DAIRY_FREE',
  'LOW_CARB',
  'OTHER',
];

const INGREDIENT_TYPE_KEYS: IngredientType[] = [
  'MEAT',
  'VEGETABLE',
  'FRUIT',
  'DAIRY',
  'GRAIN',
  'SPICE',
  'OTHER',
];

describe('RECIPE_CATEGORY_LABELS', () => {
  it('has exactly the 7 keys of RecipeCategory, no more and no less', () => {
    expect(Object.keys(RECIPE_CATEGORY_LABELS).sort()).toEqual([...RECIPE_CATEGORY_KEYS].sort());
  });

  it('maps each RecipeCategory to its exact Spanish label', () => {
    expect(RECIPE_CATEGORY_LABELS).toEqual({
      VEGAN: 'Vegano',
      VEGETARIAN: 'Vegetariano',
      HIGH_PROTEIN: 'Alto en Proteína',
      GLUTEN_FREE: 'Sin Gluten',
      DAIRY_FREE: 'Sin Lácteos',
      LOW_CARB: 'Bajo en Carbohidratos',
      OTHER: 'Otra',
    });
  });
});

describe('INGREDIENT_TYPE_LABELS', () => {
  it('has exactly the 7 keys of IngredientType, no more and no less', () => {
    expect(Object.keys(INGREDIENT_TYPE_LABELS).sort()).toEqual([...INGREDIENT_TYPE_KEYS].sort());
  });

  it('maps each IngredientType to its exact Spanish label', () => {
    expect(INGREDIENT_TYPE_LABELS).toEqual({
      MEAT: 'Carne',
      VEGETABLE: 'Vegetal',
      FRUIT: 'Fruta',
      DAIRY: 'Lácteo',
      GRAIN: 'Grano',
      SPICE: 'Especia',
      OTHER: 'Otro',
    });
  });
});
