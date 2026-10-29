import type { ShoppingListResponse } from "../types";

/** No active plan for the requested week. */
export const noPlanShoppingListFixture: ShoppingListResponse = {
  weekStart: "2026-10-19",
  plan: null,
  items: [],
  summary: { totalItems: 0, checkedItems: 0 },
  warnings: [],
};

/** A current plan with no recipe ingredients. */
export const emptyPlanShoppingListFixture: ShoppingListResponse = {
  weekStart: "2026-10-19",
  plan: {
    id: "fixture-plan-empty-2026-10-19",
    version: 1,
    updatedAt: "2026-10-19T12:00:00.000Z",
  },
  items: [],
  summary: { totalItems: 0, checkedItems: 0 },
  warnings: [],
};

/** Normal list with mixed checks and server-provided item order. */
export const shoppingListFixture: ShoppingListResponse = {
  weekStart: "2026-10-19",
  plan: {
    id: "fixture-plan-week-2026-10-19",
    version: 3,
    updatedAt: "2026-10-20T12:00:00.000Z",
  },
  items: [
    {
      key: "fixture-key-tomate-19-oct",
      name: "Tomate",
      quantity: 4,
      unit: "unidades",
      checked: true,
      sources: [
        {
          plannedMealId: "fixture-meal-1",
          recipeId: "fixture-recipe-1",
          ingredientIndex: 0,
          quantity: 4,
          unit: "unidades",
        },
      ],
    },
    {
      key: "fixture-key-arroz-g-19-oct",
      name: "Arroz",
      quantity: 250.125,
      unit: "g",
      checked: false,
      sources: [
        {
          plannedMealId: "fixture-meal-2",
          recipeId: "fixture-recipe-2",
          ingredientIndex: 1,
          quantity: 250.125,
          unit: "g",
        },
      ],
    },
    {
      key: "fixture-key-arroz-kg-19-oct",
      name: "Arroz",
      quantity: 0.75,
      unit: "kg",
      checked: false,
      sources: [
        {
          plannedMealId: "fixture-meal-3",
          recipeId: "fixture-recipe-3",
          ingredientIndex: 2,
          quantity: 0.75,
          unit: "kg",
        },
      ],
    },
  ],
  summary: { totalItems: 3, checkedItems: 1 },
  warnings: [],
};

/** Partial list: unknown quantity and both warning kinds remain explicit. */
export const partialShoppingListFixture: ShoppingListResponse = {
  weekStart: "2026-10-19",
  plan: {
    id: "fixture-plan-partial-2026-10-19",
    version: 3,
    updatedAt: "2026-10-20T12:00:00.000Z",
  },
  items: [
    {
      key: "fixture-key-tomate-unknown-19-oct",
      name: "Tomate",
      quantity: null,
      unit: null,
      checked: true,
      sources: [
        {
          plannedMealId: "fixture-meal-4",
          recipeId: "fixture-recipe-4",
          ingredientIndex: 0,
          quantity: null,
          unit: null,
        },
      ],
    },
    {
      key: "fixture-key-cebolla-19-oct",
      name: "Cebolla",
      quantity: 1.125,
      unit: "kg",
      checked: false,
      sources: [
        {
          plannedMealId: "fixture-meal-5",
          recipeId: "fixture-recipe-5",
          ingredientIndex: 1,
          quantity: 1.125,
          unit: "kg",
        },
      ],
    },
  ],
  summary: { totalItems: 2, checkedItems: 1 },
  warnings: [
    { code: "MISSING_RECIPE", plannedMealId: "fixture-meal-6" },
    {
      code: "INVALID_INGREDIENT",
      plannedMealId: "fixture-meal-5",
      ingredientIndex: 2,
    },
  ],
};

/** Warnings remain visible even when every available product is checked. */
export const checkedPartialShoppingListFixture: ShoppingListResponse = {
  ...partialShoppingListFixture,
  items: partialShoppingListFixture.items.map((item) => ({
    ...item,
    checked: true,
  })),
  summary: { totalItems: 2, checkedItems: 2 },
};

/** A missing recipe can leave no products to display while still making the result partial. */
export const warningOnlyShoppingListFixture: ShoppingListResponse = {
  ...emptyPlanShoppingListFixture,
  warnings: [
    { code: "MISSING_RECIPE", plannedMealId: "fixture-meal-missing-recipe" },
  ],
};

/** Another product week, with its own plan token, item keys and order. */
export const secondWeekShoppingListFixture: ShoppingListResponse = {
  weekStart: "2026-10-26",
  plan: {
    id: "fixture-plan-week-2026-10-26",
    version: 1,
    updatedAt: "2026-10-26T12:00:00.000Z",
  },
  items: [
    {
      key: "fixture-key-zanahoria-26-oct",
      name: "Zanahoria",
      quantity: 3,
      unit: "unidades",
      checked: false,
      sources: [
        {
          plannedMealId: "fixture-meal-next-1",
          recipeId: "fixture-recipe-next-1",
          ingredientIndex: 0,
          quantity: 3,
          unit: "unidades",
        },
      ],
    },
    {
      key: "fixture-key-yogur-26-oct",
      name: "Yogur natural, pote familiar para una receta de prueba con nombre largo",
      quantity: 0.875,
      unit: "kg",
      checked: false,
      sources: [
        {
          plannedMealId: "fixture-meal-next-2",
          recipeId: "fixture-recipe-next-2",
          ingredientIndex: 3,
          quantity: 0.875,
          unit: "kg",
        },
      ],
    },
  ],
  summary: { totalItems: 2, checkedItems: 0 },
  warnings: [],
};

/** Scenario lookup for the fixture-only page container. */
export const shoppingListFixturesByWeek: Record<string, ShoppingListResponse> =
  {
    "2026-10-05": { ...emptyPlanShoppingListFixture, weekStart: "2026-10-05" },
    "2026-10-12": { ...noPlanShoppingListFixture, weekStart: "2026-10-12" },
    [shoppingListFixture.weekStart]: shoppingListFixture,
    [secondWeekShoppingListFixture.weekStart]: secondWeekShoppingListFixture,
    "2026-11-02": { ...partialShoppingListFixture, weekStart: "2026-11-02" },
    "2026-11-09": {
      ...warningOnlyShoppingListFixture,
      weekStart: "2026-11-09",
    },
    "2026-11-16": {
      ...checkedPartialShoppingListFixture,
      weekStart: "2026-11-16",
    },
  };
