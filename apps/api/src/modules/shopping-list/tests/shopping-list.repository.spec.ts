import { ShoppingListRepository } from '../shopping-list.repository';
import { transformShoppingList } from '../shopping-list.transform';
import type { ShoppingListPlan } from '../shopping-list.types';

describe('ShoppingListRepository', () => {
  const weekStart = '2026-10-19';
  const plan: Exclude<ShoppingListPlan, null> = {
    id: 'plan-current',
    version: 2,
    updatedAt: new Date('2026-10-19T12:00:00.000Z'),
    days: [{ meals: [{
      id: 'meal-current', recipeId: 'recipe-current',
      recipe: { id: 'recipe-current', ingredients: [{ name: 'Avena', quantity: 2, unit: 'g' }] },
    }] }],
  };
  const currentKey = transformShoppingList(weekStart, plan).items[0].key;
  let repository: ShoppingListRepository;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      mealPlan: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(),
      },
      mealPlanDay: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      plannedMeal: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      recipe: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      shoppingItemCheck: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(), update: jest.fn(), upsert: jest.fn(), delete: jest.fn(), deleteMany: jest.fn(),
      },
    };
    prisma.$transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma));
    repository = new ShoppingListRepository(prisma);
  });

  it('reads only the session user’s current plan for the exact UTC week inside RepeatableRead', async () => {
    prisma.mealPlan.findFirst.mockResolvedValue(plan);

    await repository.getCurrentSnapshot('user-session-1', weekStart);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function),
      expect.objectContaining({ isolationLevel: 'RepeatableRead' }));
    expect(prisma.mealPlan.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.mealPlan.findFirst.mock.calls[0][0].where).toEqual({
      userId: 'user-session-1',
      startDate: new Date('2026-10-19T00:00:00.000Z'),
      isCurrent: true,
    });
    const selectedShape = JSON.stringify(prisma.mealPlan.findFirst.mock.calls[0][0].select);
    for (const field of ['id', 'version', 'updatedAt', 'days', 'meals', 'recipeId', 'recipe', 'ingredients']) {
      expect(selectedShape).toContain(`"${field}"`);
    }
  });

  it('reads checks only for emitted keys under the same user and current plan', async () => {
    prisma.mealPlan.findFirst.mockResolvedValue(plan);
    prisma.shoppingItemCheck.findMany.mockResolvedValue([{ itemKey: currentKey, checked: true }]);

    await expect(repository.getCurrentSnapshot('user-session-1', weekStart)).resolves.toEqual({
      plan,
      checks: [{ itemKey: currentKey, checked: true }],
    });
    expect(prisma.shoppingItemCheck.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-session-1',
        planId: plan.id,
        itemKey: { in: [currentKey] },
      },
      select: { itemKey: true, checked: true },
    });
  });

  it('returns no plan without falling back to history or another user, and does not query checks', async () => {
    await expect(repository.getCurrentSnapshot('user-without-plan', weekStart)).resolves.toEqual({
      plan: null, checks: [],
    });
    expect(prisma.mealPlan.findFirst.mock.calls[0][0].where).toEqual({
      userId: 'user-without-plan',
      startDate: new Date('2026-10-19T00:00:00.000Z'),
      isCurrent: true,
    });
    expect(prisma.shoppingItemCheck.findMany).not.toHaveBeenCalled();
  });

  it('does not read checks for an empty item set and performs no writes during GET', async () => {
    prisma.mealPlan.findFirst.mockResolvedValue({
      ...plan,
      days: [{ meals: [{ id: 'meal-empty', recipeId: 'recipe-empty', recipe: { id: 'recipe-empty', ingredients: [] } }] }],
    });

    await repository.getCurrentSnapshot('user-session-1', weekStart);

    expect(prisma.shoppingItemCheck.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    for (const delegate of [prisma.mealPlan, prisma.mealPlanDay, prisma.plannedMeal, prisma.recipe, prisma.shoppingItemCheck]) {
      for (const [method, mock] of Object.entries(delegate)) {
        if (method !== 'findFirst' && method !== 'findMany') expect(mock).not.toHaveBeenCalled();
      }
    }
  });

  it('sets a transaction-local lock timeout before locking the plan row', async () => {
    const lockedPlan = {
      id: plan.id,
      isCurrent: true,
      updatedAt: plan.updatedAt,
      startDate: new Date(`${weekStart}T00:00:00.000Z`),
    };
    const statements: Array<{ method: string; sql: string }> = [];
    prisma.$executeRaw.mockImplementation((strings: TemplateStringsArray) => {
      statements.push({ method: '$executeRaw', sql: strings.join(' ').replace(/\s+/g, ' ').trim() });
      return Promise.resolve(0);
    });
    prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const statement = strings.join(' ');
      statements.push({ method: '$queryRaw', sql: statement.replace(/\s+/g, ' ').trim() });
      return Promise.resolve(statement.includes('FOR UPDATE') ? [lockedPlan] : []);
    });
    prisma.mealPlan.findFirst.mockResolvedValue(plan);
    prisma.plannedMeal.findMany.mockResolvedValue([]);

    await repository.setChecked('user-session-1', currentKey, {
      planId: plan.id,
      planUpdatedAt: new Date(plan.updatedAt).toISOString(),
      checked: true,
    });

    expect(statements).toEqual([
      expect.objectContaining({
        method: '$executeRaw',
        sql: expect.stringMatching(/^SET LOCAL lock_timeout = '5s'$/i),
      }),
      expect.objectContaining({
        method: '$queryRaw',
        sql: expect.stringContaining('FOR UPDATE'),
      }),
    ]);
  });

  it('returns item-not-found when a valid key is absent from the recalculated current aggregate', async () => {
    prisma.$queryRaw.mockResolvedValue([{
      id: plan.id,
      isCurrent: true,
      updatedAt: plan.updatedAt,
      startDate: new Date(`${weekStart}T00:00:00.000Z`),
    }]);
    prisma.mealPlan.findFirst.mockResolvedValue(plan);
    prisma.plannedMeal.findMany.mockResolvedValue([]);

    await expect(repository.setChecked('user-session-1', 'a'.repeat(64), {
      planId: plan.id,
      planUpdatedAt: new Date(plan.updatedAt).toISOString(),
      checked: true,
    })).rejects.toMatchObject({
      status: 404,
      response: expect.objectContaining({ code: 'SHOPPING_ITEM_NOT_FOUND' }),
    });

    expect(prisma.shoppingItemCheck.upsert).not.toHaveBeenCalled();
  });

  it.each(['P2034', '40001', '40P01', '55P03'])('returns a reloadable 409 for concurrency conflict %s', async (code) => {
    prisma.$transaction = jest.fn().mockRejectedValue(
      code === 'P2034' ? { code } : { code: 'P2010', meta: { code } },
    );

    await expect(repository.setChecked('session-user', 'opaque-key', {
      planId: '21e21580-6c87-4114-932d-669b39fb8384',
      planUpdatedAt: '2026-10-19T12:00:00.000Z',
      checked: true,
    })).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'SHOPPING_LIST_STALE' }),
    });
  });

  it('propagates a transaction-start P2028 instead of disguising it as stale', async () => {
    const infrastructureFailure = Object.assign(
      new Error('Unable to start a transaction in the given time'),
      { code: 'P2028' },
    );
    prisma.$transaction = jest.fn().mockRejectedValue(infrastructureFailure);

    await expect(repository.setChecked('session-user', 'opaque-key', {
      planId: '21e21580-6c87-4114-932d-669b39fb8384',
      planUpdatedAt: '2026-10-19T12:00:00.000Z',
      checked: true,
    })).rejects.toBe(infrastructureFailure);
  });

  it('does not disguise an unknown database failure as an expected stale-list conflict', async () => {
    const unexpected = new Error('synthetic connection failure');
    prisma.$transaction = jest.fn().mockRejectedValue(unexpected);

    await expect(repository.setChecked('session-user', 'opaque-key', {
      planId: '21e21580-6c87-4114-932d-669b39fb8384',
      planUpdatedAt: '2026-10-19T12:00:00.000Z',
      checked: true,
    })).rejects.toBe(unexpected);
  });
});
