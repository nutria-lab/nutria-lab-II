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

export const INGREDIENT_TYPE_LABELS: Record<IngredientType, string> = {
  MEAT: 'Carne',
  VEGETABLE: 'Vegetal',
  FRUIT: 'Fruta',
  DAIRY: 'Lácteo',
  GRAIN: 'Grano',
  SPICE: 'Especia',
  OTHER: 'Otro',
};
