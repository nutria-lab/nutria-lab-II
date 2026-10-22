export type ShoppingListWarning = {
  code: 'MISSING_RECIPE' | 'INVALID_INGREDIENT';
  plannedMealId: string;
  ingredientIndex?: number;
};

export type ShoppingListSource = {
  plannedMealId: string;
  recipeId: string;
  ingredientIndex: number;
  quantity: number | null;
  unit: string | null;
};

export type ShoppingListItem = {
  key: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  checked: false;
  sources: ShoppingListSource[];
};

export type ShoppingListPlanMetadata = {
  id: string;
  version: number;
  updatedAt: string;
};

export type ShoppingListResponse = {
  weekStart: string;
  plan: ShoppingListPlanMetadata | null;
  items: ShoppingListItem[];
  summary: { totalItems: number; checkedItems: 0 };
  warnings: ShoppingListWarning[];
};

export type ShoppingListRecipe = { id: string; ingredients: unknown } | null;

export type ShoppingListPlannedMeal = {
  id: string;
  recipeId?: string | null;
  recipe?: ShoppingListRecipe;
};

export type ShoppingListPlan = {
  id: string;
  version: number;
  updatedAt: Date | string;
  days: Array<{ meals: ShoppingListPlannedMeal[] }>;
} | null;
