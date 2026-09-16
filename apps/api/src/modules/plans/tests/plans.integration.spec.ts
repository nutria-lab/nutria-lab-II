import 'reflect-metadata';
import { PlansRepository } from '../plans.repository';
import { MealPlanDayDto } from '../dto';
import { DayOfWeek, MealType } from '../../../generated/prisma/client';

describe('Plans Integration - Recipe Contract Persistence & Retrieval', () => {
  let repository: PlansRepository;
  let mockPrisma: any;

  const mockRecipeFromDb = {
    id: 'recipe-uuid-1',
    title: 'Pollo al Horno con Vegetales',
    description: 'Receta completa y balanceada',
    prepMinutes: 15,
    cookMinutes: 35,
    ingredients: [{ name: 'Pechuga de Pollo', quantity: 200, unit: 'g' }],
    instructions: ['Cortar los vegetales', 'Sazonar el pollo', 'Hornear 35 minutos a 180C'],
    categories: [],
    properties: [],
    nutritionalValues: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPlanFromDb = {
    id: 'plan-uuid-1',
    userId: 'user-uuid-1',
    startDate: new Date('2026-09-14T00:00:00Z'),
    endDate: new Date('2026-09-20T00:00:00Z'),
    days: [
      {
        id: 'day-uuid-1',
        mealPlanId: 'plan-uuid-1',
        day: DayOfWeek.MONDAY,
        date: new Date('2026-09-14T00:00:00Z'),
        meals: [
          {
            id: 'meal-uuid-1',
            dayId: 'day-uuid-1',
            mealType: MealType.LUNCH,
            title: 'Pollo al Horno con Vegetales',
            nutritionalValues: {
              Protein: 40,
              Fiber: 6,
              Calories: 450,
              Description: 'Almuerzo proteico',
            },
            recipeId: 'recipe-uuid-1',
            recipe: mockRecipeFromDb,
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn(async (cb: any) => {
        const tx = {
          mealPlan: { create: jest.fn().mockResolvedValue({ id: 'plan-uuid-1' }) },
          mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-uuid-1' }) },
          recipe: { create: jest.fn().mockResolvedValue(mockRecipeFromDb) },
          plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-uuid-1' }) },
        };
        return cb(tx);
      }),
      mealPlan: {
        findUnique: jest.fn().mockResolvedValue(mockPlanFromDb),
      },
    };

    repository = new PlansRepository(mockPrisma);
  });

  it('persiste la receta usando el campo instructions (y no steps)', async () => {
    const dayDto: MealPlanDayDto = {
      day: DayOfWeek.MONDAY,
      date: '2026-09-14',
      meals: [
        {
          mealType: MealType.LUNCH,
          title: 'Pollo al Horno con Vegetales',
          nutritionalValues: {
            Protein: 40,
            Fiber: 6,
            Calories: 450,
            Description: 'Almuerzo proteico',
          },
          recipe: {
            title: 'Pollo al Horno con Vegetales',
            description: 'Receta completa y balanceada',
            prepMinutes: 15,
            cookMinutes: 35,
            ingredients: [{ name: 'Pechuga de Pollo', quantity: 200, unit: 'g' }],
            instructions: ['Cortar los vegetales', 'Sazonar el pollo', 'Hornear 35 minutos a 180C'],
          },
        },
      ],
    };

    let capturedRecipeData: any;
    mockPrisma.$transaction.mockImplementationOnce(async (cb: any) => {
      const tx = {
        mealPlan: { create: jest.fn().mockResolvedValue({ id: 'plan-uuid-1' }) },
        mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-uuid-1' }) },
        recipe: {
          create: jest.fn().mockImplementation((args: any) => {
            capturedRecipeData = args.data;
            return mockRecipeFromDb;
          }),
        },
        plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-uuid-1' }) },
      };
      return cb(tx);
    });

    await repository.createPlanTransaction('user-uuid-1', new Date('2026-09-14T00:00:00Z'), [dayDto]);

    // Debe persistir instructions y NO steps
    expect(capturedRecipeData).toBeDefined();
    expect(capturedRecipeData.instructions).toEqual([
      'Cortar los vegetales',
      'Sazonar el pollo',
      'Hornear 35 minutos a 180C',
    ]);
    expect(capturedRecipeData.steps).toBeUndefined();
    expect(capturedRecipeData.title).toBe('Pollo al Horno con Vegetales');
    expect(capturedRecipeData.description).toBe('Receta completa y balanceada');
    expect(capturedRecipeData.ingredients).toEqual([
      { name: 'Pechuga de Pollo', quantity: 200, unit: 'g' },
    ]);
    // Confirma compatibilidad: no envía metadata y sostiene la creación exclusivamente con los defaults de Prisma
    expect(capturedRecipeData.categories).toBeUndefined();
    expect(capturedRecipeData.properties).toBeUndefined();
    expect(capturedRecipeData.nutritionalValues).toBeUndefined();
  });

  it('GET / findPlanByWeek devuelve la receta con instructions como array y defaults del contrato NUT-20', async () => {
    const result = await repository.findPlanByWeek('user-uuid-1', new Date('2026-09-14T00:00:00Z'));

    expect(result).toBeDefined();
    const meal = result?.days[0]?.meals[0];
    expect(meal).toBeDefined();
    const recipe = meal?.recipe as any;

    expect(recipe).toBeDefined();
    expect(recipe.title).toBe('Pollo al Horno con Vegetales');
    expect(recipe.description).toBe('Receta completa y balanceada');
    expect(recipe.prepMinutes).toBe(15);
    expect(recipe.cookMinutes).toBe(35);
    expect(recipe.ingredients).toEqual([
      { name: 'Pechuga de Pollo', quantity: 200, unit: 'g' },
    ]);
    // Verificación clave: instructions es array de strings y steps no existe
    expect(Array.isArray(recipe.instructions)).toBe(true);
    expect(recipe.instructions).toEqual([
      'Cortar los vegetales',
      'Sazonar el pollo',
      'Hornear 35 minutos a 180C',
    ]);
    expect(recipe.steps).toBeUndefined();

    // Verificación de compatibilidad con el nuevo contrato NUT-20
    expect(recipe.categories).toEqual([]);
    expect(recipe.properties).toEqual([]);
    expect(recipe.nutritionalValues).toBeNull();
  });
});
