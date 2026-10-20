import { transformShoppingList } from '../shopping-list.transform';

type MealInput = {
  id: string;
  recipeId?: string | null;
  recipe?: { id: string; ingredients: unknown } | null;
};

function meal(id: string, recipeId: string | null, ingredients?: unknown): MealInput {
  return recipeId === null
    ? { id, recipeId: null, recipe: null }
    : { id, recipeId, recipe: { id: recipeId, ingredients } };
}

function plan(meals: MealInput[], id = 'plan-current') {
  return {
    id,
    version: 3,
    updatedAt: new Date('2026-10-19T12:00:00.000Z'),
    days: [{ meals }],
  };
}

describe('transformShoppingList', () => {
  it('normalizes names with NFKC while preserving accents and consolidates canonical unit aliases', () => {
    const response = transformShoppingList('2026-10-19', plan([
      meal('meal-1', 'recipe-1', [{ name: '  ＣAFÉ   Verde  ', quantity: 0.1, unit: ' GRAMOS ' }]),
      meal('meal-2', 'recipe-2', [{ name: 'café verde', quantity: 0.2, unit: 'g' }]),
    ]));

    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      name: 'café verde',
      quantity: 0.3,
      unit: 'g',
      checked: false,
    });
    expect(response.items[0].sources).toHaveLength(2);
    expect(response.items[0].sources).toEqual([
      { plannedMealId: 'meal-1', recipeId: 'recipe-1', ingredientIndex: 0, quantity: 0.1, unit: 'g' },
      { plannedMealId: 'meal-2', recipeId: 'recipe-2', ingredientIndex: 0, quantity: 0.2, unit: 'g' },
    ]);
    expect(response.summary.checkedItems).toBe(0);
  });

  it.each([
    ['g', 'g'], ['gramo', 'g'], ['gramos', 'g'],
    ['kg', 'kg'], ['kilogramo', 'kg'], ['kilogramos', 'kg'],
    ['ml', 'ml'], ['mililitro', 'ml'], ['mililitros', 'ml'],
    ['l', 'l'], ['litro', 'l'], ['litros', 'l'],
    ['unidad', 'unidad'], ['unidades', 'unidad'],
  ])('maps only the declared unit alias %s to %s', (alias, canonical) => {
    const response = transformShoppingList('2026-10-19', plan([
      meal('meal-1', 'recipe-1', [{ name: 'Ingrediente', quantity: 1, unit: alias }]),
    ]));

    expect(response.items[0]).toMatchObject({ quantity: 1, unit: canonical });
    expect(response.warnings).toEqual([]);
  });

  it('rejects prototype property unit keys and keeps each contribution isolated by source', () => {
    const response = transformShoppingList('2026-10-19', plan([
      meal('meal-1', 'recipe-1', [
        { name: 'Sal', quantity: 5, unit: 'constructor' },
        { name: 'sal', quantity: 5, unit: 'toString' },
        { name: ' SAL ', quantity: 5, unit: '__proto__' },
      ]),
    ]));

    expect(response.items).toHaveLength(3);
    expect(response.items.every((item) => item.name === 'sal' && item.quantity === 5 && item.unit === null)).toBe(true);
    expect(response.items.every((item) => item.sources.length === 1)).toBe(true);
    expect(response.items.flatMap((item) => item.sources.map((source) => source.ingredientIndex)).sort())
      .toEqual([0, 1, 2]);
    expect(response.items.flatMap((item) => item.sources))
      .toEqual(expect.arrayContaining([
        { plannedMealId: 'meal-1', recipeId: 'recipe-1', ingredientIndex: 0, quantity: 5, unit: null },
        { plannedMealId: 'meal-1', recipeId: 'recipe-1', ingredientIndex: 1, quantity: 5, unit: null },
        { plannedMealId: 'meal-1', recipeId: 'recipe-1', ingredientIndex: 2, quantity: 5, unit: null },
      ]));
    expect(response.warnings).toEqual([
      { code: 'INVALID_INGREDIENT', plannedMealId: 'meal-1', ingredientIndex: 0 },
      { code: 'INVALID_INGREDIENT', plannedMealId: 'meal-1', ingredientIndex: 1 },
      { code: 'INVALID_INGREDIENT', plannedMealId: 'meal-1', ingredientIndex: 2 },
    ]);
    expect(response.items.map((item) => item.key)).toHaveLength(3);
  });

  it('preserves semantic and accent differences instead of merging ingredient synonyms', () => {
    const response = transformShoppingList('2026-10-19', plan([
      meal('meal-1', 'recipe-1', [
        { name: 'Café', quantity: 1, unit: 'unidad' },
        { name: 'Cafe', quantity: 1, unit: 'unidad' },
        { name: 'Coffee', quantity: 1, unit: 'unidad' },
      ]),
    ]));

    expect(response.items.map((item) => item.name)).toEqual(['cafe', 'café', 'coffee']);
    expect(response.items).toHaveLength(3);
  });

  it('counts every meal occurrence, consolidates equal canonical units, and keeps other units separate', () => {
    const response = transformShoppingList('2026-10-19', plan([
      meal('meal-1', 'recipe-repeat', [{ name: 'Arroz', quantity: 100, unit: 'g' }]),
      meal('meal-2', 'recipe-repeat', [{ name: 'arroz', quantity: 100, unit: 'gramo' }]),
      meal('meal-3', 'recipe-kg', [{ name: 'ARROZ', quantity: 0.2, unit: 'kilogramos' }]),
    ]));

    expect(response.items).toHaveLength(2);
    expect(response.items.find((item) => item.unit === 'g')).toMatchObject({ quantity: 200 });
    expect(response.items.find((item) => item.unit === 'g')?.sources).toHaveLength(2);
    expect(response.items.find((item) => item.unit === 'kg')).toMatchObject({ quantity: 0.2 });
  });

  it('uses decimal-safe accumulation and rounds once at the end with half-up behavior', () => {
    const response = transformShoppingList('2026-10-19', plan([
      meal('meal-1', 'recipe-1', [{ name: 'Harina', quantity: 0.1, unit: 'g' }]),
      meal('meal-2', 'recipe-2', [{ name: 'harina', quantity: 0.2, unit: 'gramos' }]),
      meal('meal-3', 'recipe-3', [
        { name: 'sal', quantity: 0.0004, unit: 'g' },
        { name: 'sal', quantity: 0.0004, unit: 'g' },
        { name: 'sal', quantity: 0.0004, unit: 'g' },
        { name: 'azúcar', quantity: 1.2345, unit: 'g' },
      ]),
    ]));

    expect(response.items.find((item) => item.name === 'harina')?.quantity).toBe(0.3);
    expect(response.items.find((item) => item.name === 'sal')?.quantity).toBe(0.001);
    expect(response.items.find((item) => item.name === 'sal')?.sources.map((source) => source.quantity))
      .toEqual([0.0004, 0.0004, 0.0004]);
    expect(response.items.find((item) => item.name === 'azúcar')?.quantity).toBe(1.235);
  });

  it('keeps invalid quantities and units isolated by source while preserving valid fields', () => {
    const legacyQuantities: unknown[] = [
      '1/2', 'al gusto', null, 0, -1, Number.POSITIVE_INFINITY, Number.NaN, true, {},
    ];
    const ingredients = [
      ...legacyQuantities.map((quantity) => ({ name: '  Salsa  ', quantity, unit: 'g' })),
      { name: 'salsa', quantity: 5, unit: 'taza' },
      { quantity: 3, unit: 'g' },
      { name: '   ', quantity: 3, unit: 'g' },
      { name: 42, quantity: 3, unit: 'g' },
      { name: 'salsa', unit: 'g' },
    ];
    const response = transformShoppingList('2026-10-19', plan([
      meal('meal-1', 'recipe-1', ingredients),
    ]));

    expect(response.items).toHaveLength(legacyQuantities.length + 2);
    expect(response.items.filter((item) => item.quantity === null && item.unit === 'g')).toHaveLength(legacyQuantities.length + 1);
    expect(response.items.find((item) => item.unit === null)).toMatchObject({
      name: 'salsa', quantity: 5, unit: null, sources: [{ quantity: 5, unit: null }],
    });
    expect(response.warnings).toHaveLength(legacyQuantities.length + 5);
    expect(response.warnings.every((warning) => warning.code === 'INVALID_INGREDIENT')).toBe(true);
    expect(response.warnings.filter((warning) => warning.ingredientIndex === legacyQuantities.length + 1)).toHaveLength(1);
    expect(response.warnings.filter((warning) => warning.ingredientIndex === legacyQuantities.length + 2)).toHaveLength(1);
    expect(response.warnings.filter((warning) => warning.ingredientIndex === legacyQuantities.length + 3)).toHaveLength(1);
    expect(response.warnings.filter((warning) => warning.ingredientIndex === legacyQuantities.length + 4)).toHaveLength(1);
  });

  it('warns once for a non-array ingredients value, stays silent for an empty array, and continues after a missing recipe', () => {
    const response = transformShoppingList('2026-10-19', plan([
      meal('meal-bad-json', 'recipe-bad-json', { name: 'not an array' }),
      meal('meal-empty', 'recipe-empty', []),
      meal('meal-missing-recipe', null),
      meal('meal-good', 'recipe-good', [{ name: 'Limón', quantity: 1, unit: 'unidad' }]),
    ]));

    expect(response.items).toHaveLength(1);
    expect(response.items[0].name).toBe('limón');
    expect(response.warnings).toEqual([
      { code: 'INVALID_INGREDIENT', plannedMealId: 'meal-bad-json' },
      { code: 'MISSING_RECIPE', plannedMealId: 'meal-missing-recipe' },
    ]);
  });

  it('returns the current plan metadata when it has no ingredients and a canonical empty response when absent', () => {
    const emptyPlan = transformShoppingList('2026-10-19', plan([meal('meal-empty', 'recipe-empty', [])]));
    const missingPlan = transformShoppingList('2026-10-19', null);

    expect(emptyPlan).toMatchObject({
      weekStart: '2026-10-19',
      plan: { id: 'plan-current', version: 3, updatedAt: '2026-10-19T12:00:00.000Z' },
      items: [],
      summary: { totalItems: 0, checkedItems: 0 },
      warnings: [],
    });
    expect(missingPlan).toMatchObject({
      weekStart: '2026-10-19', plan: null, items: [],
      summary: { totalItems: 0, checkedItems: 0 }, warnings: [],
    });
  });

  it('sorts sources and warnings and keeps keys stable across read order while binding them to plan and content', () => {
    const first = transformShoppingList('2026-10-19', plan([
      meal('meal-z', 'recipe-z', [{ name: 'Avena', quantity: 2, unit: 'g' }]),
      meal('meal-a', null),
      meal('meal-a2', 'recipe-a2', [{ name: 'avena', quantity: 1, unit: 'gramo' }]),
    ]));
    const reordered = transformShoppingList('2026-10-19', plan([
      meal('meal-a2', 'recipe-a2', [{ name: 'avena', quantity: 1, unit: 'gramo' }]),
      meal('meal-a', null),
      meal('meal-z', 'recipe-z', [{ name: 'Avena', quantity: 2, unit: 'g' }]),
    ]));
    const differentPlan = transformShoppingList('2026-10-19', plan([
      meal('meal-z', 'recipe-z', [{ name: 'Avena', quantity: 2, unit: 'g' }]),
      meal('meal-a', null),
      meal('meal-a2', 'recipe-a2', [{ name: 'avena', quantity: 1, unit: 'gramo' }]),
    ], 'plan-next'));
    const differentSource = transformShoppingList('2026-10-19', plan([
      meal('meal-z', 'recipe-z', [{ name: 'Avena', quantity: 2, unit: 'g' }]),
      meal('meal-a', null),
      meal('meal-a3', 'recipe-a2', [{ name: 'avena', quantity: 1, unit: 'gramo' }]),
    ]));
    const changedQuantity = transformShoppingList('2026-10-19', plan([
      meal('meal-z', 'recipe-z', [{ name: 'Avena', quantity: 3, unit: 'g' }]),
      meal('meal-a', null),
      meal('meal-a2', 'recipe-a2', [{ name: 'avena', quantity: 1, unit: 'gramo' }]),
    ]));

    expect(first).toEqual(reordered);
    expect(first.items[0].sources.map((source) => source.plannedMealId)).toEqual(['meal-a2', 'meal-z']);
    expect(first.warnings).toEqual([{ code: 'MISSING_RECIPE', plannedMealId: 'meal-a' }]);
    expect(first.items[0].key).not.toBe(differentPlan.items[0].key);
    expect(first.items[0].key).not.toBe(changedQuantity.items[0].key);
    expect(first.items[0].key).not.toBe(differentSource.items[0].key);
    expect(first.items[0].checked).toBe(false);
    expect(first.summary.checkedItems).toBe(0);
  });
});
