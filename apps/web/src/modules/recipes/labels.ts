import type { RecipeCategory } from '../../services/recipeService';
import type { IngredientType } from '../../services/ingredientService';

export const RECIPE_CATEGORY_LABELS: Record<RecipeCategory, string> = {
  VEGAN: 'Vegano',
  VEGETARIAN: 'Vegetariano',
  HIGH_PROTEIN: 'Alto en Proteína',
  GLUTEN_FREE: 'Sin Gluten',
  DAIRY_FREE: 'Sin Lácteos',
  LOW_CARB: 'Bajo en Carbohidratos',
  OTHER: 'Otra',
};

// NUT-20 (ajuste visual pedido directamente por la PO, comparando la app real contra los
// mockups de Stitch de la pantalla de recetas): un color de badge Tailwind distinto por
// categoría (fondo sólido + texto blanco), en vez del único verde de marca usado hoy para
// todas. Paleta basada en el mockup: Vegano=verde, Vegetariano=oliva, Alto en Proteína=naranja.
export const RECIPE_CATEGORY_BADGE_CLASSES: Record<RecipeCategory, string> = {
  VEGAN: 'bg-emerald-700 text-white',
  VEGETARIAN: 'bg-lime-800 text-white',
  HIGH_PROTEIN: 'bg-orange-600 text-white',
  GLUTEN_FREE: 'bg-amber-600 text-white',
  DAIRY_FREE: 'bg-sky-600 text-white',
  LOW_CARB: 'bg-purple-600 text-white',
  OTHER: 'bg-neutral-500 text-white',
};

export const INGREDIENT_TYPE_LABELS: Record<IngredientType, string> = {
  MEAT: 'Carne',
  VEGETABLE: 'Vegetal',
  FRUIT: 'Fruta',
  DAIRY: 'Lácteo',
  GRAIN: 'Grano',
  SPICE: 'Especia',
  OTHER: 'Otro',
};
