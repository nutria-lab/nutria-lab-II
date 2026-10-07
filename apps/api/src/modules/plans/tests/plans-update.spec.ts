import 'reflect-metadata';
import { PlansService } from '../plans.service';
import { DayOfWeek, MealType } from '../../../generated/prisma/client';

// NUT-78: el PUT reemplaza sólo la versión que leyó; si otra (por ejemplo una regeneración) la
// reemplazó mientras buscaba imágenes, la transacción responde 409 en vez de pisarla.
describe('PlansService.updatePlan - versión esperada (NUT-78)', () => {
  const days = [DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY, DayOfWeek.SUNDAY]
    .map((day, index) => ({
      day,
      date: `2026-09-${14 + index}`,
      meals: [{
        mealType: MealType.LUNCH,
        title: 'Ensalada de quinoa',
        nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Almuerzo' },
        recipe: { title: 'Ensalada de quinoa', description: 'x', prepMinutes: 10, cookMinutes: 10, ingredients: [{ name: 'Quinoa', quantity: 100, unit: 'g' }], instructions: ['Cocinar'] },
      }],
    }));

  it('le pasa a la transacción el id de la versión current que leyó', async () => {
    const repository: any = {
      getUserWithProfile: jest.fn().mockResolvedValue({ id: 'user-1', nutritionProfile: { goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'QUICK' } }),
      findPlanByWeek: jest.fn().mockResolvedValue({ id: 'plan-v2', days: [] }),
      createOrRecoverGenerationRun: jest.fn().mockResolvedValue({ run: { id: 'run-put', status: 'PENDING' }, wasCreated: true }),
      updatePlanTransaction: jest.fn().mockResolvedValue({ planId: 'plan-v3', recipesForTracking: [] }),
      transitionGenerationRun: jest.fn(),
    };
    const images: any = { resolveImagesOrDegrade: jest.fn(async (input: unknown) => input), trackNewRecipeImages: jest.fn() };
    const service = new PlansService(repository, images, {} as any, {} as any);

    await service.updatePlan('user-1', { weekStart: '2026-09-14', days } as any);

    expect(repository.updatePlanTransaction).toHaveBeenCalledWith(
      'user-1', new Date('2026-09-14T00:00:00Z'), expect.any(Array), 'run-put', { expectedPlanId: 'plan-v2' },
    );
  });
});
