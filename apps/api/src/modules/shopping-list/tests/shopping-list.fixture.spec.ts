import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
      expect(item.key).toEqual(expect.any(String));
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

    expect(Object.keys(fixture).sort()).toEqual(['empty', 'populated']);
    assertContract(fixture.populated);
    assertContract(fixture.empty);

    expect(fixture.populated.plan).toEqual({
      id: expect.any(String),
      version: expect.any(Number),
      updatedAt: expect.any(String),
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
