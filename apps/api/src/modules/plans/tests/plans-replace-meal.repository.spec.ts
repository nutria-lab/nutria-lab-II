import 'reflect-metadata';
import { MealReplacementConflictError, PlansRepository } from '../plans.repository';

const UPDATED_AT = new Date('2026-10-01T10:00:00.000Z');

function createTx(lockedCount = 1) {
  return {
    mealPlan: { updateMany: jest.fn().mockResolvedValue({ count: lockedCount }) },
    recipe: {
      create: jest.fn(async ({ data }: any) => ({ id: 'recipe-new', ...data })),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => ({ id: where.id, title: 'Receta del catálogo' })),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    plannedMeal: {
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, mealType: 'DINNER', ...data })),
      updateMany: jest.fn(),
    },
    generationRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
}

function setup(tx = createTx()) {
  const prisma: any = {
    $transaction: jest.fn(async (callback: any) => callback(tx)),
    mealPlan: { findUnique: jest.fn() },
  };
  return { repository: new PlansRepository(prisma), prisma, tx };
}

const baseWrite = {
  userId: 'user-1',
  planId: 'plan-1',
  expectedPlanUpdatedAt: UPDATED_AT,
  plannedMealId: 'meal-1',
  generationRunId: 'run-1',
  nutritionalValues: { Protein: 20, Fiber: 0, Calories: 350, Description: 'x' },
  outputSnapshot: { path: 'REUSED_EXISTING_RECIPE' },
  validationSnapshot: { source: 'coverage' },
};

describe('PlansRepository.findPlanWithMeals (NUT-77)', () => {
  it('busca sólo por id, sin filtrar por usuario (para poder distinguir 403 de 404)', async () => {
    const { repository, prisma } = setup();

    await repository.findPlanWithMeals('plan-1');

    expect(prisma.mealPlan.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'plan-1' } }));
  });
});

describe('PlansRepository.replaceMealTransaction (NUT-77)', () => {
  it('bloquea el plan con control optimista: mismo usuario, versión actual y mismo updatedAt', async () => {
    const { repository, tx } = setup();

    await repository.replaceMealTransaction({ ...baseWrite, existingRecipeId: 'recipe-cat' });

    expect(tx.mealPlan.updateMany).toHaveBeenCalledWith({
      where: { id: 'plan-1', userId: 'user-1', isCurrent: true, updatedAt: UPDATED_AT },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('sólo actualiza la comida objetivo y no borra la receta anterior', async () => {
    const { repository, tx } = setup();

    await repository.replaceMealTransaction({ ...baseWrite, existingRecipeId: 'recipe-cat' });

    expect(tx.plannedMeal.update).toHaveBeenCalledTimes(1);
    expect(tx.plannedMeal.update).toHaveBeenCalledWith({
      where: { id: 'meal-1' },
      data: { recipeId: 'recipe-cat', title: 'Receta del catálogo', nutritionalValues: baseWrite.nutritionalValues },
    });
    expect(tx.plannedMeal.updateMany).not.toHaveBeenCalled();
    expect(tx.recipe.delete).not.toHaveBeenCalled();
    expect(tx.recipe.deleteMany).not.toHaveBeenCalled();
    expect(tx.recipe.create).not.toHaveBeenCalled();
  });

  it('con una receta generada por IA la crea con origin AI y el generationRunId, en la misma transacción', async () => {
    const { repository, tx } = setup();

    const { recipe } = await repository.replaceMealTransaction({
      ...baseWrite,
      newRecipe: { title: 'Wok', description: 'd', prepMinutes: 10, cookMinutes: 5, ingredients: [], instructions: [] },
      title: 'Wok de verduras',
      outputSnapshot: { path: 'AI_GENERATED' },
    });

    expect(tx.recipe.create).toHaveBeenCalledWith({ data: expect.objectContaining({ title: 'Wok', origin: 'AI', generationRunId: 'run-1' }) });
    expect(tx.plannedMeal.update.mock.calls[0][0].data).toEqual(expect.objectContaining({ recipeId: 'recipe-new', title: 'Wok de verduras' }));
    expect(recipe.id).toBe('recipe-new');
  });

  it('marca el GenerationRun SUCCEEDED dentro de la transacción, guardando receta y título', async () => {
    const { repository, tx } = setup();

    await repository.replaceMealTransaction({ ...baseWrite, existingRecipeId: 'recipe-cat' });

    expect(tx.generationRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', userId: 'user-1', status: { in: ['PENDING'] } },
      data: expect.objectContaining({
        status: 'SUCCEEDED',
        outputSnapshot: { path: 'REUSED_EXISTING_RECIPE', recipeId: 'recipe-cat', title: 'Receta del catálogo' },
      }),
    });
  });

  it('si el plan cambió (0 filas bloqueadas) lanza un conflicto antes de escribir nada', async () => {
    const { repository, tx } = setup(createTx(0));

    await expect(
      repository.replaceMealTransaction({ ...baseWrite, newRecipe: { title: 'Wok' } }),
    ).rejects.toBeInstanceOf(MealReplacementConflictError);
    expect(tx.recipe.create).not.toHaveBeenCalled();
    expect(tx.plannedMeal.update).not.toHaveBeenCalled();
    expect(tx.generationRun.updateMany).not.toHaveBeenCalled();
  });

  it('si falla una escritura, el error sale de la transacción (Prisma revierte todo lo anterior)', async () => {
    const tx = createTx();
    tx.plannedMeal.update.mockRejectedValue(new Error('write failed'));
    const { repository } = setup(tx);

    await expect(
      repository.replaceMealTransaction({ ...baseWrite, newRecipe: { title: 'Wok' } }),
    ).rejects.toThrow('write failed');
    expect(tx.generationRun.updateMany).not.toHaveBeenCalled();
  });
});
