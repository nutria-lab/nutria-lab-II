import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformShoppingList } from '../shopping-list.transform';
import { ShoppingListPlan } from '../shopping-list.types';

const fixturePath = resolve(__dirname, '../../../../../../apps/web/public/fixtures/shopping-list.json');

describe('public shopping-list fixture', () => {
  function assertContract(response: any) {
    expect(Object.keys(response).sort()).toEqual(['items', 'plan', 'summary', 'warnings', 'weekStart']);
    expect(response.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(response.summary).toEqual({
      totalItems: response.items.length,
      checkedItems: 0,
    });
    expect(Array.isArray(response.warnings)).toBe(true);

    for (const item of response.items) {
      expect(Object.keys(item).sort()).toEqual(['checked', 'key', 'name', 'quantity', 'sources', 'unit']);
      expect(item.checked).toBe(false);
      expect(item.key).toMatch(/^[a-f0-9]{64}$/u);
      expect(item.sources.length).toBeGreaterThan(0);
      for (const source of item.sources) {
        expect(Object.keys(source).sort()).toEqual([
          'ingredientIndex', 'plannedMealId', 'quantity', 'recipeId', 'unit',
        ]);
      }
    }
  }

  it('contains synthetic populated and empty response examples matching contract C', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const syntheticPlan: ShoppingListPlan = {
      id: '00000000-0000-4000-8000-000000000087',
      version: 2,
      updatedAt: new Date('2026-10-19T12:00:00.000Z'),
      days: [{
        meals: [
          {
            id: 'meal-fixture-1',
            recipeId: 'recipe-fixture-1',
            recipe: {
              id: 'recipe-fixture-1',
              ingredients: [{ name: 'Arroz', quantity: 200, unit: 'g' }],
            },
          },
          {
            id: 'meal-fixture-2',
            recipeId: 'recipe-fixture-2',
            recipe: {
              id: 'recipe-fixture-2',
              ingredients: [{ name: 'arroz', quantity: 100, unit: 'gramos' }],
            },
          },
          {
            id: 'meal-fixture-3',
            recipeId: 'recipe-fixture-3',
            recipe: {
              id: 'recipe-fixture-3',
              ingredients: [{ name: 'Sal', quantity: 'al gusto', unit: 'g' }],
            },
          },
          {
            id: 'meal-fixture-4',
            recipeId: 'recipe-fixture-4',
            recipe: null,
          },
        ],
      }],
    };

    expect(Object.keys(fixture).sort()).toEqual(['empty', 'populated']);
    assertContract(fixture.populated);
    assertContract(fixture.empty);
    expect(transformShoppingList(fixture.populated.weekStart, syntheticPlan)).toEqual(fixture.populated);

    expect(fixture.populated.plan).toEqual({
      id: '00000000-0000-4000-8000-000000000087',
      version: 2,
      updatedAt: '2026-10-19T12:00:00.000Z',
    });
    expect(fixture.populated.items.some((item: any) => item.sources.length > 1)).toBe(true);
    expect(fixture.populated.items.some((item: any) => item.quantity === null || item.unit === null)).toBe(true);
    expect(fixture.populated.warnings.length).toBeGreaterThan(0);
    expect(fixture.populated.warnings.every((warning: any) =>
      ['MISSING_RECIPE', 'INVALID_INGREDIENT'].includes(warning.code))).toBe(true);

    expect(fixture.empty).toMatchObject({
      plan: null,
      items: [],
      summary: { totalItems: 0, checkedItems: 0 },
      warnings: [],
    });
  });
});
