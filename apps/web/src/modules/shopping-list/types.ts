/** A source ingredient represented in the shopping list response. */
export type ShoppingListSource = {
  plannedMealId: string;
  recipeId: string;
  ingredientIndex: number;
  quantity: number | null;
  unit: string | null;
};

/** An item returned by Contract C. The server owns aggregation and ordering. */
export type ShoppingListItem = {
  key: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  checked: boolean;
  sources: ShoppingListSource[];
};

export type ShoppingListWarning = {
  code: "MISSING_RECIPE" | "INVALID_INGREDIENT";
  plannedMealId: string;
  ingredientIndex?: number;
};

/** Exact frontend shape of GET /shopping-list (Contract C). */
export type ShoppingListResponse = {
  weekStart: string;
  plan: { id: string; version: number; updatedAt: string } | null;
  items: ShoppingListItem[];
  summary: { totalItems: number; checkedItems: number };
  warnings: ShoppingListWarning[];
};
