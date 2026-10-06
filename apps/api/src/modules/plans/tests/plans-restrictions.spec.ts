import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { PlansService } from '../plans.service';
import { DayOfWeek, MealType } from '../../../generated/prisma/client';

// El plan semanal usa la misma validación de restricciones que el reemplazo de una comida.
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
    createPlanTransaction: jest.fn().mockResolvedValue({ planId: 'plan-1', recipesForTracking: [] }),
    findPlanByWeek: jest.fn().mockResolvedValue({ id: 'plan-1', days: [] }),
  };
  // Unsplash sin efectos: devuelve los días tal cual (NUT-83 no es parte de esta prueba).
  const unsplash: any = { searchAndSelectImages: jest.fn(async (days: unknown) => days), trackDownload: jest.fn() };
  return { repository, service: new PlansService(repository, {} as any, unsplash) };
}

describe('Plan semanal - restricciones con ingredientes en español', () => {
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
});
