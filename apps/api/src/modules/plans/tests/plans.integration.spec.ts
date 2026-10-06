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
    // NUT-75 (AC10/AC11): toda fila de MealPlan ahora versiona; la "actual" es isCurrent:true.
    version: 1,
    isCurrent: true,
    supersedesId: null,
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
        // NUT-75 (AC11, Flujo E de design.md): `findPlanByWeek` deja de poder usar
        // `findUnique` con el compound `userId_startDate` porque ese `@@unique` se elimina
        // (mealPlan.prisma pasa a tener sólo `@@index([userId, startDate])`, ver plan.md
        // sección 5.3). El criterio de búsqueda pasa a `findFirst` filtrando explícitamente
        // por `isCurrent: true`. Se deja `findUnique` sin definir a propósito (en vez de
        // apuntarlo también a `mockPlanFromDb`) para que cualquier código que todavía llame
        // a `findUnique` falle de forma ruidosa en vez de pasar en verde por accidente.
        findFirst: jest.fn().mockResolvedValue(mockPlanFromDb),
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

    // NUT-75 (AC11, actualización de este test existente): el contrato de búsqueda cambió de
    // `findUnique` con el compound `userId_startDate` a `findFirst` filtrando explícitamente
    // por `isCurrent: true` (design.md Flujo E). Se agrega esta aserción sobre el mismo test
    // ya existente, en vez de duplicarlo, porque sigue siendo el mismo comportamiento de
    // negocio ("traer el plan de esta semana"): lo que cambió es el mecanismo de Prisma, no
    // el resultado esperado desde la perspectiva del caller.
    expect(mockPrisma.mealPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-uuid-1',
          startDate: new Date('2026-09-14T00:00:00Z'),
          isCurrent: true,
        }),
      }),
    );
  });

  describe('NUT-75 (AC11) - findPlanByWeek nunca devuelve una versión histórica', () => {
    const historicalPlanFromDb = {
      ...mockPlanFromDb,
      id: 'plan-uuid-0-historical',
      version: 1,
      isCurrent: false,
      supersedesId: null,
    };

    const currentPlanFromDb = {
      ...mockPlanFromDb,
      id: 'plan-uuid-1-current',
      version: 2,
      isCurrent: true,
      supersedesId: 'plan-uuid-0-historical',
    };

    it('cuando existen una versión actual y una histórica para la misma semana, sólo se devuelve la actual (isCurrent:true)', async () => {
      // Dataset con ambas filas en juego: el mock de Prisma sólo debería recibir el `where`
      // con `isCurrent: true` y resolver con la fila actual — nunca con la histórica. Esto
      // ejercita el contrato ("Prisma sólo devuelve lo que el `where` le pide"), no una
      // implementación real de filtrado en memoria.
      const findFirstMock = jest.fn().mockImplementation(async (args: any) => {
        if (args?.where?.isCurrent !== true) {
          // Si algún día el repositorio deja de filtrar por isCurrent, este mock expone el
          // bug devolviendo la fila histórica en vez de la actual.
          return historicalPlanFromDb;
        }
        return currentPlanFromDb;
      });
      mockPrisma.mealPlan.findFirst = findFirstMock;

      const result = await repository.findPlanByWeek('user-uuid-1', new Date('2026-09-14T00:00:00Z'));

      expect(result).toBeDefined();
      expect((result as any).id).toBe('plan-uuid-1-current');
      expect((result as any).isCurrent).toBe(true);
      expect((result as any).id).not.toBe('plan-uuid-0-historical');

      expect(findFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-uuid-1',
            startDate: new Date('2026-09-14T00:00:00Z'),
            isCurrent: true,
          }),
        }),
      );
    });

    it('checkPlanExists también filtra por isCurrent:true y nunca reporta una versión histórica como "existente"', async () => {
      const findFirstMock = jest.fn().mockImplementation(async (args: any) => {
        if (args?.where?.isCurrent !== true) {
          return historicalPlanFromDb;
        }
        return null; // No hay versión actual: sólo queda la histórica para esta semana.
      });
      mockPrisma.mealPlan.findFirst = findFirstMock;

      const exists = await repository.checkPlanExists('user-uuid-1', new Date('2026-09-14T00:00:00Z'));

      expect(exists).toBe(false);
      expect(findFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-uuid-1',
            startDate: new Date('2026-09-14T00:00:00Z'),
            isCurrent: true,
          }),
        }),
      );
    });
  });

  describe('NUT-75 (AC7) - Confirmación transaccional: si una escritura de dominio falla, la transición a SUCCEEDED nunca se invoca y la promesa completa rechaza', () => {
    // Reusa el mismo patrón de mock ya establecido en este archivo (`mockPrisma.$transaction.mockImplementationOnce`,
    // ver el primer test de este describe más arriba): un objeto `tx` plano con `jest.fn()` por
    // cada método de Prisma usado dentro de la transacción, más `generationRun.updateMany` para
    // poder aserir que la transición PENDING -> SUCCEEDED (Flujo C paso 1b de design.md) nunca
    // se ejecuta cuando alguna escritura de dominio anterior (paso 1a) rechaza dentro del mismo
    // callback de `$transaction`.
    const dayDtoWithRecipe: MealPlanDayDto = {
      day: DayOfWeek.MONDAY,
      date: '2026-09-14',
      meals: [
        {
          mealType: MealType.LUNCH,
          title: 'Ensalada de Quinoa',
          nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Almuerzo liviano' },
          recipe: {
            title: 'Ensalada de Quinoa',
            description: 'Ensalada liviana con quinoa y vegetales',
            prepMinutes: 10,
            cookMinutes: 15,
            ingredients: [{ name: 'Quinoa', quantity: 150, unit: 'g' }],
            instructions: ['Cocinar la quinoa', 'Mezclar con vegetales'],
          },
        },
      ],
    };

    it('createPlanTransaction: si tx.recipe.create rechaza, tx.generationRun.updateMany nunca se invoca y la promesa completa rechaza', async () => {
      const generationRunUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const domainError = new Error('unexpected constraint violation on recipe insert');

      mockPrisma.$transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          mealPlan: { create: jest.fn().mockResolvedValue({ id: 'plan-uuid-ac7-create' }) },
          mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-uuid-ac7-create' }) },
          recipe: { create: jest.fn().mockRejectedValue(domainError) },
          plannedMeal: { create: jest.fn() },
          generationRun: { updateMany: generationRunUpdateMany },
        };
        return cb(tx);
      });

      await expect(
        repository.createPlanTransaction(
          'user-uuid-1',
          new Date('2026-09-14T00:00:00Z'),
          [dayDtoWithRecipe],
          'run-ac7-create',
        ),
      ).rejects.toThrow(domainError);

      expect(generationRunUpdateMany).not.toHaveBeenCalled();
    });

    it('updatePlanTransaction (supersede): si tx.plannedMeal.create rechaza, tx.generationRun.updateMany nunca se invoca y la promesa completa rechaza', async () => {
      const generationRunUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const domainError = new Error('unexpected constraint violation on planned meal insert');

      const anteriorPlan = {
        id: 'plan-old-ac7',
        userId: 'user-uuid-1',
        startDate: new Date('2026-09-14T00:00:00Z'),
        version: 1,
        isCurrent: true,
      };

      mockPrisma.$transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          mealPlan: {
            findFirst: jest.fn().mockResolvedValue(anteriorPlan),
            update: jest.fn().mockResolvedValue({ ...anteriorPlan, isCurrent: false }),
            create: jest.fn().mockResolvedValue({
              ...anteriorPlan,
              id: 'plan-new-ac7',
              version: 2,
              isCurrent: true,
              supersedesId: anteriorPlan.id,
            }),
          },
          mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-uuid-ac7-update' }) },
          recipe: { create: jest.fn().mockResolvedValue({ id: 'recipe-uuid-ac7-update' }) },
          plannedMeal: { create: jest.fn().mockRejectedValue(domainError) },
          generationRun: { updateMany: generationRunUpdateMany },
        };
        return cb(tx);
      });

      await expect(
        repository.updatePlanTransaction(
          'user-uuid-1',
          new Date('2026-09-14T00:00:00Z'),
          [dayDtoWithRecipe],
          'run-ac7-update',
        ),
      ).rejects.toThrow(domainError);

      expect(generationRunUpdateMany).not.toHaveBeenCalled();
    });
  });
});
