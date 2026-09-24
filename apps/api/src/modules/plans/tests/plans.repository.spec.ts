import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { PlansRepository } from '../plans.repository';
import { MealPlanDayDto } from '../dto';
import { DayOfWeek, MealType } from '../../../generated/prisma/client';
import * as generationRunStateMachine from '../generation-run-state-machine';

/**
 * Unit tests aislados de PlansRepository con Prisma completamente mockeado (mismo patrón
 * de mock plano que `plans.integration.spec.ts`: `$transaction` ejecuta el callback recibido
 * contra un objeto `tx` plano con `jest.fn()` por cada método de Prisma usado, y se capturan
 * los argumentos exactos pasados a esos mocks).
 *
 * Cubre, según plan.md secciones 5 y 10:
 *  - AC2 (design.md sección 4): violación del índice único parcial al insertar la nueva
 *    versión `isCurrent:true` se propaga (no se traga silenciosamente).
 *  - AC4 (design.md sección 4): `findGenerationRunById(id, userId)` arma el `where` como
 *    `{ id, userId }`, nunca `findUnique` sólo por `id`.
 *  - AC10 (design.md sección 4 / Flujo D): dentro de la transacción de supersede, el
 *    `update` de la versión anterior (`isCurrent:false`) ocurre ANTES que el `create` de la
 *    nueva versión.
 *  - Métodos nuevos de `GenerationRun` que plan.md sección 5 pide agregar al repositorio:
 *    `createOrRecoverGenerationRun` y `transitionGenerationRun`.
 *
 * SUPUESTOS DE INTERFAZ no cerrados explícitamente por design.md/plan.md, documentados acá
 * en vez de bloquear el trabajo de esta etapa (regla explícita del prompt de esta sesión):
 *
 *  1. `updatePlanTransaction` (el método de supersede — plan.md sección 5, fila
 *     `updatePlanTransaction`, "Es el método a convertir en Flujo D") se asume reescrito con
 *     la firma `updatePlanTransaction(userId, weekStart, newDays, generationRunId)`. Ya NO
 *     recibe `planId`/`recipeIds` como hoy, porque el Flujo D paso 1 dice que la propia
 *     transacción debe ubicar la versión actual con
 *     `tx.mealPlan.findFirst({ where: { userId, startDate, isCurrent: true } })`, en vez de
 *     que el servicio se lo pase ya resuelto. Si el implementer elige otra firma (por ejemplo
 *     mantener `planId` como hint opcional), este archivo deberá actualizarse junto con él.
 *  2. `createOrRecoverGenerationRun` se asume con la firma posicional literal de plan.md
 *     sección 5: `(userId, kind, provider, model, promptVersion, schemaVersion,
 *     requestSnapshot, profileSnapshot, idempotencyKeyHash)`, devolviendo
 *     `{ run, wasCreated }`.
 *  3. El error de conflicto de Prisma se asume con forma `{ code: 'P2002' }` (código real de
 *     Prisma para violación de constraint único) — no hay precedente en este repo que ya
 *     maneje `P2002` explícitamente, así que la forma exacta del objeto de error se modela
 *     aquí como lo documenta el ADR (design.md ADR punto 1 de la sección 1, AC2).
 */
describe('PlansRepository - GenerationRun & supersede (unit, Prisma mockeado)', () => {
  let repository: PlansRepository;
  let mockPrisma: any;

  const userId = 'user-1';
  const weekStart = new Date('2026-09-14T00:00:00Z');

  const anteriorPlan = {
    id: 'plan-old-1',
    userId,
    startDate: weekStart,
    version: 1,
    isCurrent: true,
  };

  const newDays: MealPlanDayDto[] = [
    {
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
    },
  ];

  beforeEach(() => {
    mockPrisma = {};
    repository = new PlansRepository(mockPrisma);
  });

  describe('AC2 - conflicto de unicidad al regenerar (supersede)', () => {
    // CORREGIDO (Gap 4, detectado por el revisor de fiabilidad): la versión original de este
    // test afirmaba `.rejects.toMatchObject({ code: 'P2002' })`, es decir, CERTIFICABA que el
    // error crudo de Prisma se propagaba SIN TRADUCIR — ese es el comportamiento INCORRECTO,
    // no el deseado, y el test original era en sí mismo un falso positivo (pasaba en verde
    // documentando un bug). design.md AC2 pide explícitamente: "ese rechazo se traduce en un
    // error de dominio manejado (no una excepción no controlada que llegue al usuario como
    // error 500 genérico)". Se corrige la aserción para exigir la traducción a una excepción de
    // dominio manejable (ConflictException de @nestjs/common), consistente con el resto de
    // excepciones ya usadas en el módulo (BadRequestException/NotFoundException en
    // plans.service.ts).
    it('traduce el error P2002 del insert de la nueva versión a una excepción de dominio (ConflictException), no lo propaga crudo', async () => {
      const p2002Error = Object.assign(new Error('Unique constraint failed on the fields: (`userId`,`startDate`)'), {
        code: 'P2002',
      });

      const tx = {
        mealPlan: {
          findFirst: jest.fn().mockResolvedValue(anteriorPlan),
          update: jest.fn().mockResolvedValue({ ...anteriorPlan, isCurrent: false }),
          create: jest.fn().mockRejectedValue(p2002Error),
        },
        mealPlanDay: { create: jest.fn() },
        plannedMeal: { create: jest.fn() },
        recipe: { create: jest.fn() },
        generationRun: { updateMany: jest.fn() },
      };
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      await expect(
        (repository as any).updatePlanTransaction(userId, weekStart, newDays, 'run-1'),
      ).rejects.toThrow(ConflictException);

      // El repositorio no debe "atrapar y silenciar" sin intentar de verdad: el create se
      // intentó y fue lo que produjo el conflicto a traducir.
      expect(tx.mealPlan.create).toHaveBeenCalled();
    });
  });

  describe('AC4 - aislamiento por userId en lectura de GenerationRun', () => {
    it('findGenerationRunById arma el where como { id, userId } (nunca sólo por id)', async () => {
      const findFirstMock = jest.fn().mockResolvedValue({ id: 'run-1', userId, status: 'PENDING' });
      mockPrisma.generationRun = { findFirst: findFirstMock };

      await (repository as any).findGenerationRunById('run-1', userId);

      expect(findFirstMock).toHaveBeenCalledWith({ where: { id: 'run-1', userId } });
      expect(mockPrisma.generationRun.findUnique).toBeUndefined();
    });
  });

  describe('AC10 - orden UPDATE (isCurrent:false) antes que CREATE (nueva versión)', () => {
    it('ejecuta tx.mealPlan.update antes que tx.mealPlan.create dentro de la misma transacción', async () => {
      const callOrder: string[] = [];

      const tx = {
        mealPlan: {
          findFirst: jest.fn().mockResolvedValue(anteriorPlan),
          update: jest.fn().mockImplementation(async () => {
            callOrder.push('update');
            return { ...anteriorPlan, isCurrent: false };
          }),
          create: jest.fn().mockImplementation(async (args: any) => {
            callOrder.push('create');
            return { id: 'plan-new-1', ...args.data };
          }),
        },
        mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-1' }) },
        plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-1' }) },
        recipe: { create: jest.fn().mockResolvedValue({ id: 'recipe-1' }) },
        generationRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      await (repository as any).updatePlanTransaction(userId, weekStart, newDays, 'run-1');

      expect(callOrder).toEqual(['update', 'create']);
      expect(tx.mealPlan.update).toHaveBeenCalledWith({
        where: { id: anteriorPlan.id },
        data: { isCurrent: false },
      });
      expect(tx.mealPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            startDate: weekStart,
            version: anteriorPlan.version + 1,
            isCurrent: true,
            supersedesId: anteriorPlan.id,
          }),
        }),
      );
    });
  });

  describe('createOrRecoverGenerationRun', () => {
    const args = {
      userId,
      kind: 'MEAL_PLAN_INITIAL',
      provider: 'google-generative-ai',
      model: 'gemini-1.5-flash',
      promptVersion: '1.0.0',
      schemaVersion: '1.0.0',
      requestSnapshot: { kind: 'MEAL_PLAN_INITIAL', weekStart: '2026-09-14' },
      profileSnapshot: {
        goal: 'LOSE_WEIGHT',
        diet: 'VEGAN',
        excludedIngredients: [],
        cookTimePreference: 'QUICK',
      },
      idempotencyKeyHash: 'abc123hash',
    };

    it('crea un GenerationRun nuevo y devuelve wasCreated:true cuando no hay conflicto de unicidad', async () => {
      const createdRun = { id: 'run-1', ...args, status: 'PENDING' };
      mockPrisma.generationRun = {
        create: jest.fn().mockResolvedValue(createdRun),
        findFirst: jest.fn(),
      };

      const result = await (repository as any).createOrRecoverGenerationRun(
        args.userId,
        args.kind,
        args.provider,
        args.model,
        args.promptVersion,
        args.schemaVersion,
        args.requestSnapshot,
        args.profileSnapshot,
        args.idempotencyKeyHash,
      );

      expect(mockPrisma.generationRun.create).toHaveBeenCalledWith({
        data: {
          userId: args.userId,
          kind: args.kind,
          provider: args.provider,
          model: args.model,
          promptVersion: args.promptVersion,
          schemaVersion: args.schemaVersion,
          requestSnapshot: args.requestSnapshot,
          profileSnapshot: args.profileSnapshot,
          idempotencyKeyHash: args.idempotencyKeyHash,
        },
      });
      expect(result).toEqual({ run: createdRun, wasCreated: true });
      expect(mockPrisma.generationRun.findFirst).not.toHaveBeenCalled();
    });

    it('recupera el GenerationRun existente y devuelve wasCreated:false cuando create falla por P2002 (AC3)', async () => {
      const existingRun = { id: 'run-existing-1', ...args, status: 'SUCCEEDED' };
      const p2002Error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      mockPrisma.generationRun = {
        create: jest.fn().mockRejectedValue(p2002Error),
        findFirst: jest.fn().mockResolvedValue(existingRun),
      };

      const result = await (repository as any).createOrRecoverGenerationRun(
        args.userId,
        args.kind,
        args.provider,
        args.model,
        args.promptVersion,
        args.schemaVersion,
        args.requestSnapshot,
        args.profileSnapshot,
        args.idempotencyKeyHash,
      );

      expect(mockPrisma.generationRun.findFirst).toHaveBeenCalledWith({
        where: { userId: args.userId, kind: args.kind, idempotencyKeyHash: args.idempotencyKeyHash },
      });
      expect(result).toEqual({ run: existingRun, wasCreated: false });
    });
  });

  describe('transitionGenerationRun', () => {
    it('usa updateMany con where {id, userId, status:{in: fromStatuses}} y devuelve el count afectado', async () => {
      mockPrisma.generationRun = {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };

      const result = await (repository as any).transitionGenerationRun(
        'run-1',
        userId,
        ['PENDING'],
        'SUCCEEDED',
        { outputSnapshot: { foo: 'bar' } },
      );

      expect(mockPrisma.generationRun.updateMany).toHaveBeenCalledWith({
        where: { id: 'run-1', userId, status: { in: ['PENDING'] } },
        data: expect.objectContaining({ status: 'SUCCEEDED', outputSnapshot: { foo: 'bar' } }),
      });
      expect(result).toBe(1);
    });

    it('devuelve count 0 cuando ningún estado de origen coincide (transición inválida, respaldo de concurrencia)', async () => {
      mockPrisma.generationRun = {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      };

      const result = await (repository as any).transitionGenerationRun(
        'run-1',
        userId,
        ['PENDING'],
        'SUCCEEDED',
      );

      expect(result).toBe(0);
    });
  });

  describe('Gap 5 (MEDIO) - transitionGenerationRun debe usar isValidTransition (fuente de verdad de la máquina de estados) antes de tocar Prisma', () => {
    // design.md sección 7, punto 1: "Una tabla/función en código de aplicación... es la fuente
    // de verdad sobre qué transición es semánticamente legal". Hoy `transitionGenerationRun`
    // (y `transitionGenerationRunInTx`) llaman directo a `prisma.generationRun.updateMany` sin
    // pasar antes por `isValidTransition` (importable de `generation-run-state-machine.ts`,
    // que hoy sólo se usa en su propio spec, `generation-run-state-machine.spec.ts` — no desde
    // ningún caller real). Esto es defensa de aplicación redundante con el respaldo de
    // concurrencia de la base (el `where: { status: { in: fromStatuses } }` ya evita persistir
    // una transición inválida), pero intencional según el diseño.
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('usa isValidTransition para validar la transición antes del updateMany, y lanza sin llamar a Prisma cuando la transición es inválida (FAILED -> SUCCEEDED, FAILED es terminal)', async () => {
      const isValidTransitionSpy = jest.spyOn(generationRunStateMachine, 'isValidTransition');
      const updateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      mockPrisma.generationRun = { updateMany: updateManyMock };

      // FAILED es terminal (VALID_TRANSITIONS.FAILED === [] en generation-run-state-machine.ts),
      // así que isValidTransition('FAILED', 'SUCCEEDED') debe ser false y el método debe
      // rechazar sin siquiera intentar el updateMany condicional contra Prisma.
      await expect(
        (repository as any).transitionGenerationRun('run-1', userId, ['FAILED'], 'SUCCEEDED'),
      ).rejects.toThrow();

      expect(isValidTransitionSpy).toHaveBeenCalledWith('FAILED', 'SUCCEEDED');
      expect(updateManyMock).not.toHaveBeenCalled();
    });

    it('para una transición válida (PENDING -> SUCCEEDED) sí consulta isValidTransition y procede a llamar updateMany', async () => {
      const isValidTransitionSpy = jest.spyOn(generationRunStateMachine, 'isValidTransition');
      const updateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      mockPrisma.generationRun = { updateMany: updateManyMock };

      await (repository as any).transitionGenerationRun('run-1', userId, ['PENDING'], 'SUCCEEDED');

      expect(isValidTransitionSpy).toHaveBeenCalledWith('PENDING', 'SUCCEEDED');
      expect(updateManyMock).toHaveBeenCalled();
    });
  });

  describe('Gap 6 (MEDIO) - outputSnapshot/validationSnapshot deben poblarse en la transición final a SUCCEEDED', () => {
    // Hoy `transitionGenerationRunInTx` se invoca desde `createPlanTransaction`/
    // `updatePlanTransaction` sin ningún cuarto argumento `data`, así que la transición final a
    // SUCCEEDED nunca incluye `outputSnapshot`/`validationSnapshot` — quedan `null` para
    // siempre en el camino exitoso, aunque el modelo Prisma los declara y design.md Flujo C
    // paso 1b dice explícitamente "con outputSnapshot/validationSnapshot ya poblados".
    it('createPlanTransaction: el data pasado a la transición final a SUCCEEDED incluye outputSnapshot y validationSnapshot no vacíos', async () => {
      const updateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const tx = {
        mealPlan: { create: jest.fn().mockResolvedValue({ id: 'plan-1' }) },
        mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-1' }) },
        recipe: { create: jest.fn().mockResolvedValue({ id: 'recipe-1' }) },
        plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-1' }) },
        generationRun: { updateMany: updateManyMock },
      };
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      await repository.createPlanTransaction(userId, weekStart, newDays, 'run-1');

      expect(updateManyMock).toHaveBeenCalledTimes(1);
      const callArgs = updateManyMock.mock.calls[0][0];
      expect(callArgs.data.outputSnapshot).toBeDefined();
      expect(callArgs.data.outputSnapshot).not.toBeNull();
      expect(callArgs.data.validationSnapshot).toBeDefined();
      expect(callArgs.data.validationSnapshot).not.toBeNull();
    });

    it('updatePlanTransaction (supersede): la transición final a SUCCEEDED también incluye outputSnapshot/validationSnapshot no vacíos', async () => {
      const updateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const tx = {
        mealPlan: {
          findFirst: jest.fn().mockResolvedValue(anteriorPlan),
          update: jest.fn().mockResolvedValue({ ...anteriorPlan, isCurrent: false }),
          create: jest.fn().mockImplementation(async (args: any) => ({ id: 'plan-new-1', ...args.data })),
        },
        mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-1' }) },
        plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-1' }) },
        recipe: { create: jest.fn().mockResolvedValue({ id: 'recipe-1' }) },
        generationRun: { updateMany: updateManyMock },
      };
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      await repository.updatePlanTransaction(userId, weekStart, newDays, 'run-1');

      expect(updateManyMock).toHaveBeenCalledTimes(1);
      const callArgs = updateManyMock.mock.calls[0][0];
      expect(callArgs.data.outputSnapshot).toBeDefined();
      expect(callArgs.data.outputSnapshot).not.toBeNull();
      expect(callArgs.data.validationSnapshot).toBeDefined();
      expect(callArgs.data.validationSnapshot).not.toBeNull();
    });
  });
});
