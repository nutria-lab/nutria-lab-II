import { ShoppingListService } from '../shopping-list.service';
import { transformShoppingList } from '../shopping-list.transform';
import type { ShoppingListPlan } from '../shopping-list.types';

const weekStart = '2026-10-19';
const planId = '21e21580-6c87-4114-932d-669b39fb8384';
const planUpdatedAt = '2026-10-19T12:00:00.000Z';

function plan(ingredients: unknown[], id = planId): ShoppingListPlan {
  return {
    id,
    version: 2,
    updatedAt: planUpdatedAt,
    days: [{ meals: [{
      id: 'meal-one',
      recipeId: 'recipe-one',
      recipe: { id: 'recipe-one', ingredients },
    }] }],
  };
}

describe('ShoppingListService check state', () => {
  let snapshot: jest.Mock;
  let setChecked: jest.Mock;
  let service: ShoppingListService;

  beforeEach(() => {
    snapshot = jest.fn();
    setChecked = jest.fn().mockResolvedValue(undefined);
    service = new ShoppingListService({ getCurrentSnapshot: snapshot, setChecked } as never);
  });

  it('overlays only current item keys and derives checkedItems from returned items', async () => {
    const current = plan([
      { name: 'Avena', quantity: 2, unit: 'g' },
      { name: 'Manzana', quantity: 1, unit: 'unidad' },
    ]);
    const original = transformShoppingList(weekStart, current);
    const avena = original.items.find(item => item.name === 'avena')!;
    snapshot.mockResolvedValue({
      plan: current,
      checks: [
        { itemKey: avena.key, checked: true },
        { itemKey: 'previous-key-no-longer-in-list', checked: true },
      ],
    });

    const result = await service.getForWeek('session-user', weekStart);

    expect(snapshot).toHaveBeenCalledWith('session-user', weekStart);
    expect(result.items).toEqual(original.items.map(item => ({
      ...item,
      checked: item.key === avena.key,
    })));
    expect(result.summary).toEqual({ totalItems: 2, checkedItems: 1 });
    expect(result.warnings).toEqual(original.warnings);
  });

  it('keeps an identical key checked across a new plan token, but not after a quantity change', async () => {
    const before = plan([{ name: 'Avena', quantity: 2, unit: 'g' }]);
    const originalKey = transformShoppingList(weekStart, before).items[0].key;
    snapshot.mockResolvedValueOnce({
      plan: { ...before, updatedAt: '2026-10-20T12:00:00.000Z' },
      checks: [{ itemKey: originalKey, checked: true }],
    });
    snapshot.mockResolvedValueOnce({
      plan: plan([{ name: 'Avena', quantity: 3, unit: 'g' }]),
      checks: [{ itemKey: originalKey, checked: true }],
    });

    const retained = await service.getForWeek('session-user', weekStart);
    const invalidated = await service.getForWeek('session-user', weekStart);

    expect(retained.items[0]).toMatchObject({ key: originalKey, checked: true });
    expect(retained.summary.checkedItems).toBe(1);
    expect(invalidated.items[0].key).not.toBe(originalKey);
    expect(invalidated.items[0].checked).toBe(false);
    expect(invalidated.summary.checkedItems).toBe(0);
  });

  it('never inherits a check from an earlier planId and does not write during GET', async () => {
    const old = plan([{ name: 'Avena', quantity: 2, unit: 'g' }]);
    const next = plan([{ name: 'Avena', quantity: 2, unit: 'g' }], 'plan-regenerated');
    const oldKey = transformShoppingList(weekStart, old).items[0].key;
    snapshot.mockResolvedValue({ plan: next, checks: [{ itemKey: oldKey, checked: true }] });

    const result = await service.getForWeek('session-user', weekStart);

    expect(result.items[0].key).not.toBe(oldKey);
    expect(result.items[0].checked).toBe(false);
    expect(result.summary.checkedItems).toBe(0);
    expect(setChecked).not.toHaveBeenCalled();
  });

  it('returns the unchanged empty contract for no current plan', async () => {
    snapshot.mockResolvedValue({ plan: null, checks: [] });

    await expect(service.getForWeek('session-user', weekStart)).resolves.toEqual({
      weekStart,
      plan: null,
      items: [],
      summary: { totalItems: 0, checkedItems: 0 },
      warnings: [],
    });
    expect(setChecked).not.toHaveBeenCalled();
  });

  it('passes the exact boolean set intent and token to persistence on every request', async () => {
    const input = { planId, planUpdatedAt, checked: true };

    await expect(service.setChecked('session-user', 'opaque-key', input)).resolves.toEqual({
      itemKey: 'opaque-key', checked: true,
    });
    await expect(service.setChecked('session-user', 'opaque-key', input)).resolves.toEqual({
      itemKey: 'opaque-key', checked: true,
    });
    await expect(service.setChecked('session-user', 'opaque-key', { ...input, checked: false })).resolves.toEqual({
      itemKey: 'opaque-key', checked: false,
    });
    expect(setChecked.mock.calls).toEqual([
      ['session-user', 'opaque-key', input],
      ['session-user', 'opaque-key', input],
      ['session-user', 'opaque-key', { ...input, checked: false }],
    ]);
  });
});
