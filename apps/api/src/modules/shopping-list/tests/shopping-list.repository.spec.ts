import { ShoppingListRepository } from '../shopping-list.repository';

describe('ShoppingListRepository', () => {
  const weekStart = '2026-10-19';
  let repository: ShoppingListRepository;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      mealPlan: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      mealPlanDay: { create: jest.fn(), createMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
      plannedMeal: { create: jest.fn(), createMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
      recipe: { create: jest.fn(), createMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
    };
    repository = new ShoppingListRepository(prisma);
  });

  it('queries only the requesting user’s current plan for the exact UTC calendar week', async () => {
    await repository.findCurrentPlan('user-session-1', weekStart);

    expect(prisma.mealPlan.findFirst).toHaveBeenCalledTimes(1);
    const query = prisma.mealPlan.findFirst.mock.calls[0][0];
    expect(query.where).toEqual({
      userId: 'user-session-1',
      startDate: new Date('2026-10-19T00:00:00.000Z'),
      isCurrent: true,
    });
  });

  it('projects the plan version, meal and recipe identity, and raw Recipe.ingredients needed by the contract', async () => {
    await repository.findCurrentPlan('user-session-1', weekStart);

    const query = prisma.mealPlan.findFirst.mock.calls[0][0];
    const selection = query.select ?? query.include;
    const selectedShape = JSON.stringify(selection);
    for (const field of ['id', 'version', 'updatedAt', 'days', 'meals', 'recipeId', 'recipe', 'ingredients']) {
      expect(selectedShape).toContain(`"${field}"`);
    }
  });

  it('returns no plan without falling back to history or another user when the current scoped query has no row', async () => {
    prisma.mealPlan.findFirst.mockResolvedValue(null);

    await expect(repository.findCurrentPlan('user-without-plan', weekStart)).resolves.toBeNull();

    expect(prisma.mealPlan.findFirst.mock.calls[0][0].where).toEqual({
      userId: 'user-without-plan',
      startDate: new Date('2026-10-19T00:00:00.000Z'),
      isCurrent: true,
    });
  });

  it('performs no writes while reading the shopping list', async () => {
    await repository.findCurrentPlan('user-session-1', weekStart);

    for (const delegate of [prisma.mealPlan, prisma.mealPlanDay, prisma.plannedMeal, prisma.recipe]) {
      for (const [method, mock] of Object.entries(delegate)) {
        if (method !== 'findFirst') expect(mock).not.toHaveBeenCalled();
      }
    }
  });
});
