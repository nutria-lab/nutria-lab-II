import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { PlansService } from '../plans.service';
import { RecipeImagesService } from '../recipe-images.service';
import { DayOfWeek, MealType } from '../../../generated/prisma/client';

// Manual weekly plans retain exclusion enforcement during the initial AI experiment.
const DAYS = [
  DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY, DayOfWeek.SATURDAY, DayOfWeek.SUNDAY,
];

function week(mondayTitle: string, mondayIngredient = 'Quinoa') {
  return DAYS.map((day, index) => {
    const title = index === 0 ? mondayTitle : 'Ensalada de quinoa';
    return {
      day,
      date: `2026-09-${14 + index}`,
      meals: [{
        mealType: MealType.LUNCH,
        title,
        nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Almuerzo' },
        recipe: {
          title,
          description: 'Receta de prueba',
          prepMinutes: 10,
          cookMinutes: 10,
          ingredients: [{ name: index === 0 ? mondayIngredient : 'Quinoa', quantity: 100, unit: 'g' }],
          instructions: ['Cocinar'],
        },
      }],
    };
  });
}

function setup(excludedIngredients: string[]) {
  const repository: any = {
    getUserWithProfile: jest.fn().mockResolvedValue({ id: 'user-1', nutritionProfile: { diet: 'ALL', excludedIngredients } }),
    checkPlanExists: jest.fn().mockResolvedValue(false),
    transitionGenerationRun: jest.fn().mockResolvedValue(1),
    createPlanTransaction: jest.fn().mockResolvedValue({ planId: 'plan-1', recipesForTracking: [] }),
    findPlanByWeek: jest.fn().mockResolvedValue({ id: 'plan-1', days: [] }),
  };
  // Unsplash sin efectos: devuelve los días tal cual (NUT-83 no es parte de esta prueba).
  const unsplash: any = { searchAndSelectImages: jest.fn(async (days: unknown) => days), trackDownload: jest.fn() };
  return { repository, service: new PlansService(repository, new RecipeImagesService(repository, unsplash), {} as any, {} as any) };
}

describe('Plan semanal - restricciones con ingredientes en español', () => {
  it('bypasses the persistence exclusion gate for an initial AI run without mutating the profile', async () => {
    const { repository, service } = setup(['DAIRY']);
    const user = await repository.getUserWithProfile();
    const originalProfile = structuredClone(user.nutritionProfile);

    await service.validateAndPersistPlan('user-1', {
      weekStart: '2026-09-14', days: week('Crema de cacahuate'),
    } as any, 'run-initial');

    expect(repository.createPlanTransaction).toHaveBeenCalledTimes(1);
    expect(user.nutritionProfile).toEqual(originalProfile);
  });

  it.each([6, 8])('keeps the seven-day requirement with an initial AI run (%p days)', async (count) => {
    const { repository, service } = setup(['DAIRY']);
    const days = Array.from({ length: count }, (_, index) => week('Crema de cacahuate')[index % 7]);

    await expect(service.validateAndPersistPlan('user-1', { weekStart: '2026-09-14', days } as any, 'run-initial'))
      .rejects.toThrow('Plan must have exactly 7 days');
    expect(repository.createPlanTransaction).not.toHaveBeenCalled();
  });

  it('keeps the nonempty-meal requirement with an initial AI run', async () => {
    const { repository, service } = setup(['DAIRY']);
    const days = week('Crema de cacahuate');
    days[0].meals = [];

    await expect(service.validateAndPersistPlan('user-1', { weekStart: '2026-09-14', days } as any, 'run-initial'))
      .rejects.toThrow('Empty meal list');
    expect(repository.createPlanTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['NUTS', 'Budín de nueces', 'Harina'],
    ['DAIRY', 'Fideos con queso y leche', 'Fideos'],
    ['GLUTEN', 'Pan de trigo', 'Trigo'],
    ['SHELLFISH', 'Arroz con camarones', 'Arroz'],
    ['SOY', 'Salteado con salsa de soja', 'Verduras'],
  ])('rechaza el plan si un perfil con %s recibe "%s"', async (restriction, title, ingredient) => {
    const { repository, service } = setup([restriction]);

    await expect(service.validateAndPersistPlan('user-1', { weekStart: '2026-09-14', days: week(title, ingredient) } as any))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createPlanTransaction).not.toHaveBeenCalled();
  });

  it('rechaza un alérgeno que sólo aparece en los ingredientes', async () => {
    const { service } = setup(['NUTS']);

    await expect(service.validateAndPersistPlan('user-1', { weekStart: '2026-09-14', days: week('Ensalada verde', 'Almendras tostadas') } as any))
      .rejects.toThrow('contains excluded ingredient/concept: nuts');
  });

  it('acepta un plan sin alérgenos del perfil', async () => {
    const { repository, service } = setup(['NUTS', 'SHELLFISH']);

    await service.validateAndPersistPlan('user-1', { weekStart: '2026-09-14', days: week('Ensalada de quinoa') } as any);

    expect(repository.createPlanTransaction).toHaveBeenCalledTimes(1);
  });

  it('revisa también el título de la receta y los pasos (mismos textos que el validador)', async () => {
    const { service } = setup(['NUTS']);
    const days = week('Ensalada verde');
    days[0].meals[0].recipe.instructions = ['Mezclar', 'Agregar maní picado'];

    await expect(service.validateAndPersistPlan('user-1', { weekStart: '2026-09-14', days } as any))
      .rejects.toThrow('contains excluded ingredient/concept: nuts');
  });
});
