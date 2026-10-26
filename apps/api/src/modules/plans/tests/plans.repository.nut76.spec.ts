import { DayOfWeek, MealType } from '../../../generated/prisma/client';
import { PlansRepository } from '../plans.repository';

const weekStart = new Date('2026-09-14T00:00:00.000Z');

function meal(overrides: Record<string, unknown> = {}) {
  return {
    mealType: MealType.BREAKFAST,
    title: 'Bowl de avena',
    nutritionalValues: { Calories: 350, Protein: 20, Fiber: 8, Description: 'Desayuno' },
    recipe: {
      title: 'Bowl de avena',
      description: 'Avena con fruta',
      prepMinutes: 10,
      cookMinutes: 15,
      ingredients: [{ name: 'Avena', quantity: 50, unit: 'g' }],
      instructions: ['Mezclar'],
    },
    ...overrides,
  };
}

function day(meals: any[]) {
  return [{ day: DayOfWeek.MONDAY, date: '2026-09-14', meals }];
}

function findProperty(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProperty(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  for (const nested of Object.values(record)) {
    const found = findProperty(nested, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe('PlansRepository NUT-76 writer behavior', () => {
  function setup(options: { recipeCreate?: jest.Mock; runUpdate?: jest.Mock } = {}) {
    const recipeCreate = options.recipeCreate ?? jest.fn().mockResolvedValue({ id: 'recipe-created-1' });
    const runUpdate = options.runUpdate ?? jest.fn().mockResolvedValue({ count: 1 });
    const plannedMealCreate = jest.fn().mockResolvedValue({ id: 'planned-meal-1' });
    const transaction = {
      mealPlan: { create: jest.fn().mockResolvedValue({ id: 'plan-1' }) },
      mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-1' }) },
      recipe: { create: recipeCreate, update: jest.fn(), updateMany: jest.fn() },
      plannedMeal: { create: plannedMealCreate },
      generationRun: { updateMany: runUpdate },
    };
    const prisma = { $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback(transaction)) };
    return { repository: new PlansRepository(prisma as any), prisma, transaction, recipeCreate, runUpdate, plannedMealCreate };
  }

  it('references a selected catalog ID without creating or mutating that Recipe', async () => {
    const { repository, recipeCreate, plannedMealCreate, transaction } = setup();
    const catalogId = 'existing-catalog-recipe';

    await repository.createPlanTransaction('user-1', weekStart, day([meal({ recipe: undefined, reuseRecipeId: catalogId })]) as any, 'run-1');

    expect(recipeCreate).not.toHaveBeenCalled();
    expect(transaction.recipe.update).not.toHaveBeenCalled();
    expect(transaction.recipe.updateMany).not.toHaveBeenCalled();
    expect(plannedMealCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ recipeId: catalogId }),
    });
  });

  it('creates an AI Recipe once, stores its measured macros, and points the PlannedMeal to the created ID', async () => {
    const { repository, recipeCreate, plannedMealCreate } = setup();

    await repository.createPlanTransaction('user-1', weekStart, day([meal()]) as any, 'run-weekly');

    expect(recipeCreate).toHaveBeenCalledTimes(1);
    expect(recipeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        generationRunId: 'run-weekly',
        origin: 'AI',
        nutritionalValues: { calories: 350, protein: 20, fiber: 8, description: 'Desayuno' },
      }),
    });
    expect(plannedMealCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipeId: 'recipe-created-1',
        nutritionalValues: { Calories: 350, Protein: 20, Fiber: 8, Description: 'Desayuno' },
      }),
    });
  });

  it('includes the internal composition version, provider usage, and model manifest in the success snapshot', async () => {
    const { repository, runUpdate } = setup();
    const compositionSnapshot = {
      compositionVersion: 'weekly-catalog-composition-v1',
      aiInvoked: true,
      batches: [{ mealType: MealType.BREAKFAST, model: 'gpt-test', promptVersion: 'recipe-candidate-test-v1' }],
    };

    await (repository as any).createPlanTransaction(
      'user-1', weekStart, day([meal()]) as any, 'run-weekly', undefined,
      { stage: 'passed', codes: [], warnings: [] }, compositionSnapshot,
    );

    const succeeded = runUpdate.mock.calls[0][0].data;
    expect(succeeded.status).toBe('SUCCEEDED');
    expect(findProperty(succeeded.outputSnapshot, 'compositionVersion')).toBe('weekly-catalog-composition-v1');
    expect(findProperty(succeeded.outputSnapshot, 'aiInvoked')).toBe(true);
    expect(findProperty(succeeded.outputSnapshot, 'batches')).toEqual(compositionSnapshot.batches);
  });

  it('leaves the transaction rejected when a new Recipe insert fails before the run can succeed', async () => {
    const insertError = new Error('recipe insert failed');
    const runUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const { repository, recipeCreate } = setup({ recipeCreate: jest.fn().mockRejectedValue(insertError), runUpdate });

    await expect(repository.createPlanTransaction('user-1', weekStart, day([meal()]) as any, 'run-weekly')).rejects.toBe(insertError);

    expect(recipeCreate).toHaveBeenCalledTimes(1);
    expect(runUpdate).not.toHaveBeenCalled();
  });
});
