import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { PlansRepository } from '../plans.repository';
import { MealPlanDayDto } from '../dto';
import { DayOfWeek, MealType } from '../../../generated/prisma/client';
import * as generationRunStateMachine from '../generation-run-state-machine';
import { pendingPersistedImage } from '../../unsplash/unsplash-search.fixture';

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

  it('findPlanByWeek only reads the current version of this user\'s plan for this week, recipes included', async () => {
    mockPrisma.mealPlan = { findFirst: jest.fn().mockResolvedValue(null) };

    await repository.findPlanByWeek(userId, weekStart);

    const args = mockPrisma.mealPlan.findFirst.mock.calls[0][0];
    expect(args.where).toEqual({ userId, startDate: weekStart, isCurrent: true });
    expect(args.include.days.include.meals.include).toEqual({ recipe: true });
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

  /**
   * NUT-75 — Bug 1 (BLOQUEANTE, revisión externa de PR): `PUT /meal-plans`
   * (`PlansService.updatePlan` -> `PlansRepository.updatePlanTransaction`) es el endpoint de
   * edición MANUAL documentado en `.ai/meal-plans.md` ("Allow a user to edit a meal directly by
   * overwriting the specific meal's fields") — nunca llama a Gemini, persiste `dto.days` tal
   * cual lo manda el cliente. Sin embargo, `PlansService.updatePlan` SIEMPRE crea/recupera un
   * `GenerationRun` de kind `MEAL_PLAN_REGENERATION` y le pasa su `id` a
   * `updatePlanTransaction` como `generationRunId` — y `createDaysMealsAndRecipes`
   * (`plans.repository.ts:99-102`) estampa incondicionalmente `recipeData.origin = 'AI'` cada
   * vez que recibe un `generationRunId`, sin distinguir si ese run vino de una llamada real a
   * Gemini (`createPlanTransaction`, camino de `generateAndPersistPlan`) o no
   * (`updatePlanTransaction`, camino de edición manual). Resultado: toda receta creada/editada
   * a mano vía `PUT /meal-plans` queda mal etiquetada como `origin: 'AI'`.
   *
   * Decisión de test tomada acá (el prompt de esta etapa pide decidir y documentar cuál forma
   * es "más correcta"): se exige que el `origin` pasado a `tx.recipe.create` en el camino
   * MANUAL nunca sea `'AI'` — se acepta tanto que el implementer omita el campo `origin` por
   * completo (dejando que el `@default(MANUAL)` de Prisma aplique, la opción más simple y la
   * recomendada por esta autora del test) como que lo estampe explícitamente en `'MANUAL'`;
   * lo único que estas pruebas prohíben es `'AI'`. El contraste con `createPlanTransaction`
   * (que SÍ debe seguir estampando `'AI'`) se deja explícito en el segundo test.
   */
  describe('Bug 1 (BLOQUEANTE) - origin de Recipe según el camino de escritura (manual vs. generación IA real)', () => {
    it('updatePlanTransaction (PUT /meal-plans, edición MANUAL) NUNCA estampa origin: "AI" en las recetas creadas, aunque reciba un generationRunId válido', async () => {
      const capturedRecipeData: any[] = [];
      const tx = {
        mealPlan: {
          findFirst: jest.fn().mockResolvedValue(anteriorPlan),
          update: jest.fn().mockResolvedValue({ ...anteriorPlan, isCurrent: false }),
          create: jest.fn().mockImplementation(async (args: any) => ({ id: 'plan-new-1', ...args.data })),
        },
        mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-1' }) },
        recipe: {
          create: jest.fn().mockImplementation(async (args: any) => {
            capturedRecipeData.push(args.data);
            return { id: 'recipe-1' };
          }),
        },
        plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-1' }) },
        generationRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      // updatePlanTransaction recibe un generationRunId válido (el de MEAL_PLAN_REGENERATION,
      // creado por PlansService.updatePlan) aunque este camino nunca llama a Gemini.
      await repository.updatePlanTransaction(userId, weekStart, newDays, 'run-manual-edit-1');

      expect(capturedRecipeData.length).toBeGreaterThan(0);
      for (const recipeData of capturedRecipeData) {
        expect(recipeData.origin).not.toBe('AI');
      }
    });

    it('createPlanTransaction (camino de generación real vía Gemini) SÍ estampa origin: "AI" cuando recibe un generationRunId (contraste explícito con el camino manual)', async () => {
      const capturedRecipeData: any[] = [];
      const tx = {
        mealPlan: { create: jest.fn().mockResolvedValue({ id: 'plan-1' }) },
        mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-1' }) },
        recipe: {
          create: jest.fn().mockImplementation(async (args: any) => {
            capturedRecipeData.push(args.data);
            return { id: 'recipe-1' };
          }),
        },
        plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-1' }) },
        generationRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      await repository.createPlanTransaction(userId, weekStart, newDays, 'run-ai-generation-1');

      expect(capturedRecipeData.length).toBeGreaterThan(0);
      for (const recipeData of capturedRecipeData) {
        expect(recipeData.origin).toBe('AI');
      }
    });
  });

  /**
   * NUT-75 — Bug 4 (NO bloqueante, revisión externa de PR): `buildOutputSnapshot`
   * (`plans.repository.ts:212-217`) sólo guarda `{ dayCount, mealCount }` como `outputSnapshot`
   * de la transición final a `SUCCEEDED`. El objetivo del ticket es poder auditar QUÉ produjo
   * la generación (títulos, ingredientes, instrucciones), no sólo cuántos días/comidas hubo.
   * Estos tests verifican que el contenido real generado (por ejemplo el título de una receta
   * del fixture) pueda reconstruirse desde el `outputSnapshot` persistido, sin imponerle al
   * implementer una forma exacta más allá de eso.
   */
  describe('Bug 4 (NO bloqueante) - outputSnapshot debe permitir reconstruir el contenido real generado, no sólo conteos', () => {
    it('createPlanTransaction: el outputSnapshot de la transición final a SUCCEEDED incluye el título real de al menos una receta del fixture', async () => {
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
      // newDays[0].meals[0].recipe.title === 'Ensalada de Quinoa' (fixture de este archivo).
      expect(JSON.stringify(callArgs.data.outputSnapshot)).toContain('Ensalada de Quinoa');
    });

    it('updatePlanTransaction (supersede): el outputSnapshot también incluye el contenido real generado, no sólo conteos', async () => {
      const updateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const tx = {
        mealPlan: {
          findFirst: jest.fn().mockResolvedValue(anteriorPlan),
          update: jest.fn().mockResolvedValue({ ...anteriorPlan, isCurrent: false }),
          create: jest.fn().mockImplementation(async (args: any) => ({ id: 'plan-new-1', ...args.data })),
        },
        mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-1' }) },
        recipe: { create: jest.fn().mockResolvedValue({ id: 'recipe-1' }) },
        plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-1' }) },
        generationRun: { updateMany: updateManyMock },
      };
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      await repository.updatePlanTransaction(userId, weekStart, newDays, 'run-1');

      expect(updateManyMock).toHaveBeenCalledTimes(1);
      const callArgs = updateManyMock.mock.calls[0][0];
      expect(JSON.stringify(callArgs.data.outputSnapshot)).toContain('Ensalada de Quinoa');
    });
  });

  describe('NUT-83 - integración de `image` resuelto (createPlanTransaction / updatePlanTransaction)', () => {
    const sampleRecipeImage = pendingPersistedImage();

    const withRecipeImage = (image: unknown): any =>
      newDays.map(day => ({
        ...day,
        meals: day.meals.map(meal => ({
          ...meal,
          recipe: meal.recipe ? { ...meal.recipe, image } : meal.recipe,
        })),
      }));

    const buildCreateTx = (capturedRecipeData: any[]) => ({
      mealPlan: { create: jest.fn().mockResolvedValue({ id: 'plan-1' }) },
      mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-1' }) },
      recipe: {
        create: jest.fn().mockImplementation(async (args: any) => {
          capturedRecipeData.push(args.data);
          return { id: 'recipe-1' };
        }),
      },
      plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-1' }) },
      generationRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    });

    it('createPlanTransaction: cuando meal.recipe.image trae un RecipeImage, ese valor llega tal cual al data de tx.recipe.create', async () => {
      const capturedRecipeData: any[] = [];
      const tx = buildCreateTx(capturedRecipeData);
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      await repository.createPlanTransaction(userId, weekStart, withRecipeImage(sampleRecipeImage), 'run-1');

      expect(capturedRecipeData.length).toBeGreaterThan(0);
      for (const recipeData of capturedRecipeData) {
        expect(recipeData.image).toEqual(sampleRecipeImage);
      }
    });

    it('createPlanTransaction: cuando meal.recipe.image es null (Unsplash no encontró nada / falló), se pasa null tal cual, sin omitir la clave', async () => {
      const capturedRecipeData: any[] = [];
      const tx = buildCreateTx(capturedRecipeData);
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      await repository.createPlanTransaction(userId, weekStart, withRecipeImage(null), 'run-1');

      expect(capturedRecipeData.length).toBeGreaterThan(0);
      for (const recipeData of capturedRecipeData) {
        expect(Object.prototype.hasOwnProperty.call(recipeData, 'image')).toBe(true);
        expect(recipeData.image).toBeNull();
      }
    });

    it('createPlanTransaction: cuando meal.recipe.image NO está definido (undefined, caso de hoy sin este ticket), el data pasado a tx.recipe.create NO incluye la clave "image" en absoluto (no pisa el default de Prisma)', async () => {
      const capturedRecipeData: any[] = [];
      const tx = buildCreateTx(capturedRecipeData);
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      // newDays (fixture de este archivo) no trae ninguna propiedad `image` en `meal.recipe`.
      await repository.createPlanTransaction(userId, weekStart, newDays, 'run-1');

      expect(capturedRecipeData.length).toBeGreaterThan(0);
      for (const recipeData of capturedRecipeData) {
        expect(Object.prototype.hasOwnProperty.call(recipeData, 'image')).toBe(false);
      }
    });

    it('updatePlanTransaction (camino manual, PUT /meal-plans): cuando meal.recipe.image trae un RecipeImage, ese valor llega tal cual al data de tx.recipe.create (D1 corregido: mismo comportamiento que createPlanTransaction, sin importar origin)', async () => {
      const capturedRecipeData: any[] = [];
      const tx = {
        mealPlan: {
          findFirst: jest.fn().mockResolvedValue(anteriorPlan),
          update: jest.fn().mockResolvedValue({ ...anteriorPlan, isCurrent: false }),
          create: jest.fn().mockImplementation(async (args: any) => ({ id: 'plan-new-1', ...args.data })),
        },
        mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-1' }) },
        recipe: {
          create: jest.fn().mockImplementation(async (args: any) => {
            capturedRecipeData.push(args.data);
            return { id: 'recipe-1' };
          }),
        },
        plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-1' }) },
        generationRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      await repository.updatePlanTransaction(userId, weekStart, withRecipeImage(sampleRecipeImage), 'run-manual-edit-1');

      expect(capturedRecipeData.length).toBeGreaterThan(0);
      for (const recipeData of capturedRecipeData) {
        expect(recipeData.image).toEqual(sampleRecipeImage);
      }
    });
  });

  describe('NUT-83 revisión de reviewers - Gap 1 (BLOQUEANTE) - outputSnapshot de GenerationRun nunca debe incluir datos de Unsplash', () => {
    const sampleRecipeImage = pendingPersistedImage();

    const withRecipeImage = (image: unknown): any =>
      newDays.map(day => ({
        ...day,
        meals: day.meals.map(meal => ({
          ...meal,
          recipe: meal.recipe ? { ...meal.recipe, image } : meal.recipe,
        })),
      }));

    function assertNoRecipeHasImageKeyAndKeepsRestOfContent(outputSnapshot: any) {
      expect(outputSnapshot).toBeDefined();
      expect(outputSnapshot.days).toBeDefined();
      let recipesChecked = 0;
      for (const day of outputSnapshot.days) {
        for (const meal of day.meals) {
          if (meal.recipe) {
            recipesChecked += 1;
            // La clave "image" no debe existir en absoluto -- ni siquiera como `null`.
            expect(Object.prototype.hasOwnProperty.call(meal.recipe, 'image')).toBe(false);
            // El resto del contenido de la receta (título, etc.) sigue presente sin cambios.
            expect(meal.recipe.title).toBe('Ensalada de Quinoa');
          }
        }
      }
      // Guarda de que el test realmente ejerció al menos una receta (fixture no vacío).
      expect(recipesChecked).toBeGreaterThan(0);
    }

    it('createPlanTransaction: el outputSnapshot pasado a la transición final a SUCCEEDED NO incluye la clave "image" en ninguna receta, aunque meal.recipe.image venga definido', async () => {
      const updateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const tx = {
        mealPlan: { create: jest.fn().mockResolvedValue({ id: 'plan-1' }) },
        mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-1' }) },
        recipe: { create: jest.fn().mockResolvedValue({ id: 'recipe-1' }) },
        plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-1' }) },
        generationRun: { updateMany: updateManyMock },
      };
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      await repository.createPlanTransaction(userId, weekStart, withRecipeImage(sampleRecipeImage), 'run-1');

      expect(updateManyMock).toHaveBeenCalledTimes(1);
      const callArgs = updateManyMock.mock.calls[0][0];
      assertNoRecipeHasImageKeyAndKeepsRestOfContent(callArgs.data.outputSnapshot);
    });

    it('updatePlanTransaction (supersede): el outputSnapshot pasado a la transición final a SUCCEEDED NO incluye la clave "image" en ninguna receta, aunque meal.recipe.image venga definido', async () => {
      const updateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const tx = {
        mealPlan: {
          findFirst: jest.fn().mockResolvedValue(anteriorPlan),
          update: jest.fn().mockResolvedValue({ ...anteriorPlan, isCurrent: false }),
          create: jest.fn().mockImplementation(async (args: any) => ({ id: 'plan-new-1', ...args.data })),
        },
        mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-1' }) },
        recipe: { create: jest.fn().mockResolvedValue({ id: 'recipe-1' }) },
        plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-1' }) },
        generationRun: { updateMany: updateManyMock },
      };
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      await repository.updatePlanTransaction(userId, weekStart, withRecipeImage(sampleRecipeImage), 'run-1');

      expect(updateManyMock).toHaveBeenCalledTimes(1);
      const callArgs = updateManyMock.mock.calls[0][0];
      assertNoRecipeHasImageKeyAndKeepsRestOfContent(callArgs.data.outputSnapshot);
    });
  });

  describe('NUT-83 - createPlanTransaction/updatePlanTransaction devuelven los recipeId creados para registrar uso después (design.md 6.3)', () => {
    const pendingImage = pendingPersistedImage();

    const withPendingImage = (image: unknown): any =>
      newDays.map(day => ({
        ...day,
        meals: day.meals.map(meal => ({
          ...meal,
          recipe: meal.recipe ? { ...meal.recipe, image } : meal.recipe,
        })),
      }));

    it('createPlanTransaction: el resultado incluye recipesForTracking con el recipeId real y el image con tracking.status PENDING, además de seguir identificando el plan creado', async () => {
      const capturedRecipeData: any[] = [];
      const tx = {
        mealPlan: { create: jest.fn().mockResolvedValue({ id: 'plan-1' }) },
        mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-1' }) },
        recipe: {
          create: jest.fn().mockImplementation(async (args: any) => {
            capturedRecipeData.push(args.data);
            return { id: 'recipe-created-99' };
          }),
        },
        plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-1' }) },
        generationRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      const result: any = await repository.createPlanTransaction(
        userId,
        weekStart,
        withPendingImage(pendingImage),
        'run-1',
      );

      expect(result.planId).toBe('plan-1');
      expect(result.recipesForTracking).toEqual([{ recipeId: 'recipe-created-99', image: pendingImage }]);
    });

    // El servicio reconoce las imágenes conservadas por referencia: tiene que volver el mismo objeto.
    it('recipesForTracking keeps the received image reference, and a payload recipe id is never written to the new row', async () => {
      const capturedRecipeData: any[] = [];
      const tx = {
        mealPlan: { create: jest.fn().mockResolvedValue({ id: 'plan-1' }) },
        mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-1' }) },
        recipe: {
          create: jest.fn().mockImplementation(async (args: any) => {
            capturedRecipeData.push(args.data);
            return { id: 'recipe-created-99' };
          }),
        },
        plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-1' }) },
        generationRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));
      const days = withPendingImage(pendingImage);
      days[0].meals[0].recipe.id = '7f8a1c2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b';

      const result: any = await repository.createPlanTransaction(userId, weekStart, days, 'run-1');

      expect(result.recipesForTracking[0].image).toBe(pendingImage);
      expect(capturedRecipeData[0]).not.toHaveProperty('id');
    });

    it('createPlanTransaction: cuando ninguna receta nueva trae image resuelto (todas reusadas o sin image), recipesForTracking es un array vacío', async () => {
      const tx = {
        mealPlan: { create: jest.fn().mockResolvedValue({ id: 'plan-1' }) },
        mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-1' }) },
        recipe: { create: jest.fn().mockResolvedValue({ id: 'recipe-1' }) },
        plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-1' }) },
        generationRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      // newDays (fixture de este archivo) no trae ninguna propiedad `image` en `meal.recipe`.
      const result: any = await repository.createPlanTransaction(userId, weekStart, newDays, 'run-1');

      expect(result.recipesForTracking).toEqual([]);
    });

    it('updatePlanTransaction (camino manual): el resultado también incluye recipesForTracking (mismo comportamiento que createPlanTransaction, D1 corregido)', async () => {
      const capturedRecipeData: any[] = [];
      const tx = {
        mealPlan: {
          findFirst: jest.fn().mockResolvedValue(anteriorPlan),
          update: jest.fn().mockResolvedValue({ ...anteriorPlan, isCurrent: false }),
          create: jest.fn().mockImplementation(async (args: any) => ({ id: 'plan-new-1', ...args.data })),
        },
        mealPlanDay: { create: jest.fn().mockResolvedValue({ id: 'day-1' }) },
        recipe: {
          create: jest.fn().mockImplementation(async (args: any) => {
            capturedRecipeData.push(args.data);
            return { id: 'recipe-updated-77' };
          }),
        },
        plannedMeal: { create: jest.fn().mockResolvedValue({ id: 'meal-1' }) },
        generationRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(tx));

      const result: any = await repository.updatePlanTransaction(
        userId,
        weekStart,
        withPendingImage(pendingImage),
        'run-manual-edit-1',
      );

      expect(result.planId).toBe('plan-new-1');
      expect(result.recipesForTracking).toEqual([{ recipeId: 'recipe-updated-77', image: pendingImage }]);
    });
  });
});
