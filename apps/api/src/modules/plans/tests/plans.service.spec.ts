import 'reflect-metadata';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { PlansService } from '../plans.service';
import { DayOfWeek, MealType } from '../../../generated/prisma/client';

/**
 * Unit tests de PlansService con PlansRepository y GeminiService mockeados (mismo patrón de
 * mock plano usado en `plans.repository.spec.ts`/`plans.integration.spec.ts`, pero acá el
 * mock es del repositorio completo, no de Prisma).
 *
 * Cubre, según plan.md secciones 6 y 10:
 *  - AC3: misma solicitud (mismo `idempotencyKeyHash` resultante) no vuelve a invocar al
 *    proveedor de IA ni crea un segundo `GenerationRun`.
 *  - AC9: `repository.createOrRecoverGenerationRun` se resuelve ANTES de invocar
 *    `gemini.generateMealPlan` (Flujo A paso 5 antes que paso 6, design.md sección 3).
 *  - AC8 (complemento): `generation-run-snapshot.spec.ts` (etapa 1) ya cubre exhaustivamente
 *    la lista blanca de `profileSnapshot` vía `buildProfileSnapshot`, así que NO se duplica
 *    acá. Lo que ese archivo no cubre es `requestSnapshot` (no existe todavía ningún
 *    `buildRequestSnapshot` ni equivalente en el código), así que este archivo agrega un
 *    test de que `generateAndPersistPlan` arma `requestSnapshot` por lista blanca exacta
 *    (`kind`, `weekStart`, `promptVersion`, `schemaVersion` — design.md sección 6) antes de
 *    pasarlo al repositorio.
 *
 * SUPUESTO DE INTERFAZ documentado (no cerrado explícitamente por design.md/plan.md): se
 * asume que `generateAndPersistPlan` llama a
 * `repository.createOrRecoverGenerationRun(userId, kind, provider, model, promptVersion,
 * schemaVersion, requestSnapshot, profileSnapshot, idempotencyKeyHash)` (firma posicional de
 * plan.md sección 5) ANTES de decidir si invoca a `gemini.generateMealPlan`, y que cuando el
 * resultado trae `wasCreated:false` el servicio corta el flujo sin volver a llamar al
 * proveedor (AC3, Flujo A paso 5 de design.md). Hoy `PlansService` no llama a este método en
 * absoluto (usa sólo `checkPlanExists`, una noción de idempotencia distinta y más gruesa —
 * ver plan.md sección 6, nota de solape), así que todas las aserciones de esta suite
 * deberían fallar en rojo contra la implementación actual.
 */
describe('PlansService - Idempotencia y trazabilidad de GenerationRun (unit)', () => {
  let service: PlansService;
  let mockRepository: any;
  let mockGemini: any;

  const userId = 'user-1';
  const weekStartStr = '2026-09-14';

  const mockNutritionProfile = {
    id: 'profile-1',
    userId,
    goal: 'LOSE_WEIGHT',
    diet: 'VEGAN',
    excludedIngredients: [],
    cookTimePreference: 'QUICK',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  const mockUser = {
    id: userId,
    nutritionProfile: mockNutritionProfile,
  };

  // El DTO real (MealDto) exige 7 días y `recipe` obligatorio en cada comida (ver
  // meal.dto.ts) — generateAndPersistPlan valida esto con class-validator antes de persistir,
  // así que el fixture debe ser una semana completa y válida para que las aserciones de esta
  // suite fallen por la razón correcta (falta de interfaz de GenerationRun), no por un 400 de
  // validación de estructura que enmascare el rojo esperado.
  const buildValidDay = (day: DayOfWeek, date: string) => ({
    day,
    date,
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
  });

  const generatedDays = [
    buildValidDay(DayOfWeek.MONDAY, '2026-09-14'),
    buildValidDay(DayOfWeek.TUESDAY, '2026-09-15'),
    buildValidDay(DayOfWeek.WEDNESDAY, '2026-09-16'),
    buildValidDay(DayOfWeek.THURSDAY, '2026-09-17'),
    buildValidDay(DayOfWeek.FRIDAY, '2026-09-18'),
    buildValidDay(DayOfWeek.SATURDAY, '2026-09-19'),
    buildValidDay(DayOfWeek.SUNDAY, '2026-09-20'),
  ];

  const newRun = { id: 'run-new-1', userId, kind: 'MEAL_PLAN_INITIAL', status: 'PENDING' };
  const existingRun = { id: 'run-existing-1', userId, kind: 'MEAL_PLAN_INITIAL', status: 'SUCCEEDED' };

  const persistedPlan = { id: 'plan-1', userId, days: [] };

  beforeEach(() => {
    mockGemini = {
      generateMealPlan: jest.fn().mockResolvedValue(generatedDays),
    };

    mockRepository = {
      getUserWithProfile: jest.fn().mockResolvedValue(mockUser),
      checkPlanExists: jest.fn().mockResolvedValue(false),
      createOrRecoverGenerationRun: jest
        .fn()
        .mockResolvedValueOnce({ run: newRun, wasCreated: true })
        .mockResolvedValueOnce({ run: existingRun, wasCreated: false }),
      createPlanTransaction: jest.fn().mockResolvedValue(persistedPlan.id),
      findPlanByWeek: jest.fn().mockResolvedValue(persistedPlan),
      transitionGenerationRun: jest.fn().mockResolvedValue(1),
    };

    service = new PlansService(mockRepository, mockGemini);
  });

  describe('AC3 - misma solicitud no duplica ejecución', () => {
    it('llama a Gemini una sola vez y no crea un segundo GenerationRun al repetir la misma solicitud', async () => {
      await service.generateAndPersistPlan(userId, weekStartStr);
      await service.generateAndPersistPlan(userId, weekStartStr);

      expect(mockRepository.createOrRecoverGenerationRun).toHaveBeenCalledTimes(2);
      // La segunda vez debe recuperar el run existente (wasCreated:false) y NO volver a
      // invocar al proveedor de IA.
      expect(mockGemini.generateMealPlan).toHaveBeenCalledTimes(1);
    });

    it('la segunda llamada devuelve el mismo plan persistido sin crear una fila de dominio nueva', async () => {
      const firstResult = await service.generateAndPersistPlan(userId, weekStartStr);
      const secondResult = await service.generateAndPersistPlan(userId, weekStartStr);

      expect(secondResult).toEqual(firstResult);
      // Sólo debería haber una confirmación transaccional real (la primera vez).
      expect(mockRepository.createPlanTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('AC9 - GenerationRun se crea/recupera antes de invocar al proveedor de IA', () => {
    it('resuelve createOrRecoverGenerationRun antes de invocar gemini.generateMealPlan', async () => {
      const callOrder: string[] = [];

      mockRepository.createOrRecoverGenerationRun = jest.fn().mockImplementation(async () => {
        callOrder.push('createOrRecoverGenerationRun');
        return { run: newRun, wasCreated: true };
      });
      mockGemini.generateMealPlan = jest.fn().mockImplementation(async () => {
        callOrder.push('generateMealPlan');
        return generatedDays;
      });

      await service.generateAndPersistPlan(userId, weekStartStr);

      expect(callOrder).toEqual(['createOrRecoverGenerationRun', 'generateMealPlan']);
    });
  });

  describe('AC8 (complemento) - requestSnapshot se arma por lista blanca exacta antes de persistir', () => {
    it('pasa a createOrRecoverGenerationRun un requestSnapshot con exactamente kind/weekStart/promptVersion/schemaVersion', async () => {
      let capturedRequestSnapshot: any;
      let capturedProfileSnapshot: any;

      mockRepository.createOrRecoverGenerationRun = jest.fn().mockImplementation(async (
        _userId: string,
        _kind: string,
        _provider: string,
        _model: string,
        _promptVersion: string,
        _schemaVersion: string,
        requestSnapshot: any,
        profileSnapshot: any,
      ) => {
        capturedRequestSnapshot = requestSnapshot;
        capturedProfileSnapshot = profileSnapshot;
        return { run: newRun, wasCreated: true };
      });

      await service.generateAndPersistPlan(userId, weekStartStr);

      expect(capturedRequestSnapshot).toBeDefined();
      expect(Object.keys(capturedRequestSnapshot).sort()).toEqual(
        ['kind', 'promptVersion', 'schemaVersion', 'weekStart'].sort(),
      );
      expect(capturedRequestSnapshot.kind).toBe('MEAL_PLAN_INITIAL');
      expect(capturedRequestSnapshot.weekStart).toBe(weekStartStr);

      // No debe filtrarse ningún dato de identidad del usuario (email/name) al perfil.
      expect(capturedProfileSnapshot).toBeDefined();
      expect(Object.keys(capturedProfileSnapshot).sort()).toEqual(
        ['cookTimePreference', 'diet', 'excludedIngredients', 'goal'].sort(),
      );
      expect(capturedProfileSnapshot.id).toBeUndefined();
      expect(capturedProfileSnapshot.userId).toBeUndefined();
    });
  });

  /**
   * NUT-75 — gaps de comportamiento confirmados independientemente por más de un revisor
   * (`*_review_risk/readability/reliability/resilience`) contra la implementación ya "verde"
   * de las etapas anteriores. Estos tests deben fallar en rojo hoy; documentan el
   * comportamiento correcto que el implementer debe hacer pasar.
   */

  describe('NUT-75 Gap 1 (CRITICO) - idempotencyKeyHash de MEAL_PLAN_REGENERATION debe incluir el contenido de dto.days', () => {
    // Hoy requestSnapshot para updatePlan es {kind, weekStart, promptVersion, schemaVersion}
    // (mismo shape que MEAL_PLAN_INITIAL): dos PUT /meal-plans distintos para la misma semana,
    // con `days` completamente distintos, producen el MISMO idempotencyKeyHash, así que el
    // segundo se descarta en silencio (wasCreated:false corta el flujo antes de persistir).
    const buildDaysVariant = (firstMealTitle: string) => {
      const days = generatedDays.map(d => ({ ...d, meals: d.meals.map(m => ({ ...m })) }));
      days[0] = { ...days[0], meals: [{ ...days[0].meals[0], title: firstMealTitle }] };
      return days;
    };

    it('dos actualizaciones de la misma semana con dto.days distinto producen requestSnapshot/hash DISTINTOS, y la segunda persiste su propio contenido (no wasCreated:false cortando el flujo)', async () => {
      const existingPlan = { id: 'plan-1', userId, days: [] };
      mockRepository.findPlanByWeek = jest.fn().mockResolvedValue(existingPlan);

      const capturedRequestSnapshots: any[] = [];
      const capturedHashes: string[] = [];
      // Simula el comportamiento real de deduplicación del repositorio (createOrRecoverGenerationRun):
      // un mismo idempotencyKeyHash recupera el run existente con wasCreated:false; un hash
      // nuevo crea un run nuevo con wasCreated:true. Esto es necesario para que el test exponga
      // el efecto real del bug (la segunda llamada se corta), no sólo la forma del snapshot.
      const runsByHash = new Map<string, any>();
      let runCounter = 0;
      mockRepository.createOrRecoverGenerationRun = jest.fn().mockImplementation(
        async (
          _userId: string,
          kind: string,
          _provider: string,
          _model: string,
          _promptVersion: string,
          _schemaVersion: string,
          requestSnapshot: any,
          _profileSnapshot: any,
          idempotencyKeyHash: string,
        ) => {
          capturedRequestSnapshots.push(requestSnapshot);
          capturedHashes.push(idempotencyKeyHash);
          if (runsByHash.has(idempotencyKeyHash)) {
            return { run: runsByHash.get(idempotencyKeyHash), wasCreated: false };
          }
          runCounter += 1;
          const run = { id: `run-regen-${runCounter}`, userId, kind, status: 'PENDING' };
          runsByHash.set(idempotencyKeyHash, run);
          return { run, wasCreated: true };
        },
      );
      mockRepository.updatePlanTransaction = jest.fn().mockResolvedValue('plan-1');
      mockRepository.transitionGenerationRun = jest.fn().mockResolvedValue(1);

      const dtoFirst = { weekStart: weekStartStr, days: buildDaysVariant('Ensalada Original') } as any;
      const dtoSecond = { weekStart: weekStartStr, days: buildDaysVariant('Ensalada Completamente Distinta') } as any;

      await service.updatePlan(userId, dtoFirst);
      await service.updatePlan(userId, dtoSecond);

      // El requestSnapshot/hash de la segunda solicitud debe ser distinto del de la primera,
      // porque el contenido de `days` cambió.
      expect(capturedRequestSnapshots.length).toBe(2);
      expect(capturedRequestSnapshots[0]).not.toEqual(capturedRequestSnapshots[1]);
      expect(capturedHashes[0]).not.toBe(capturedHashes[1]);

      // Consecuencia observable: la segunda llamada debe llegar a updatePlanTransaction con
      // el contenido del segundo request (no debe cortarse por wasCreated:false).
      expect(mockRepository.updatePlanTransaction).toHaveBeenCalledTimes(2);
      expect(mockRepository.updatePlanTransaction).toHaveBeenNthCalledWith(
        2,
        userId,
        expect.any(Date),
        dtoSecond.days,
        expect.any(String),
      );
    });
  });

  describe('NUT-75 Gap 2 (CRITICO) - recuperar un GenerationRun terminal-fallido no debe dar un 404 engañoso', () => {
    // Hoy, cuando createOrRecoverGenerationRun devuelve wasCreated:false, el servicio asume
    // incondicionalmente éxito y llama a getPlanByWeek, que lanza NotFoundException si nunca se
    // persistió nada (caso de un run recuperado en FAILED/REJECTED/PENDING, no SUCCEEDED).
    //
    // NOTA: esto NO resuelve el desbloqueo de reintentos (queda fuera de alcance, es una
    // decisión de diseño pendiente) — estos tests sólo exigen que el error sea honesto
    // (distinguible del NotFoundException genérico), no que se permita reintentar.

    it('lanza una excepción de dominio honesta (no NotFoundException) cuando el run recuperado está en FAILED', async () => {
      mockRepository.createOrRecoverGenerationRun = jest.fn().mockResolvedValue({
        run: { id: 'run-failed-1', userId, kind: 'MEAL_PLAN_INITIAL', status: 'FAILED', errorCode: 'AI_TIMEOUT' },
        wasCreated: false,
      });
      // Nada se persistió nunca para esta semana (el run recuperado nunca llegó a SUCCEEDED).
      mockRepository.findPlanByWeek = jest.fn().mockResolvedValue(null);

      let thrown: any;
      try {
        await service.generateAndPersistPlan(userId, weekStartStr);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeDefined();
      expect(thrown).not.toBeInstanceOf(NotFoundException);
      expect(thrown).toBeInstanceOf(ConflictException);
      expect(thrown.message).toEqual(expect.stringContaining('FAILED'));
    });

    it('repite el caso con status REJECTED', async () => {
      mockRepository.createOrRecoverGenerationRun = jest.fn().mockResolvedValue({
        run: {
          id: 'run-rejected-1',
          userId,
          kind: 'MEAL_PLAN_INITIAL',
          status: 'REJECTED',
          errorCode: 'RESTRICTION_VIOLATION',
        },
        wasCreated: false,
      });
      mockRepository.findPlanByWeek = jest.fn().mockResolvedValue(null);

      let thrown: any;
      try {
        await service.generateAndPersistPlan(userId, weekStartStr);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeDefined();
      expect(thrown).not.toBeInstanceOf(NotFoundException);
      expect(thrown).toBeInstanceOf(ConflictException);
      expect(thrown.message).toEqual(expect.stringContaining('REJECTED'));
    });
  });

  describe('NUT-75 Gap 3 (ALTO) - rollback de la transacción debe transicionar el GenerationRun a FAILED', () => {
    // design.md Flujo C punto 2: "Si cualquier paso de (a) falla ..., la transacción completa
    // hace rollback y el GenerationRun se transiciona a FAILED en una operación separada
    // posterior." Hoy ni generateAndPersistPlan ni updatePlan capturan el rechazo de
    // createPlanTransaction/updatePlanTransaction para hacer esa transición: el error de la
    // transacción simplemente se re-lanza tal cual, dejando el GenerationRun colgado en PENDING.

    it('generateAndPersistPlan: si createPlanTransaction rechaza, el servicio transiciona el run a FAILED antes de relanzar', async () => {
      const domainError = new Error('unexpected constraint violation inside transaction');
      mockRepository.createPlanTransaction = jest.fn().mockRejectedValue(domainError);

      await expect(service.generateAndPersistPlan(userId, weekStartStr)).rejects.toThrow(domainError);

      expect(mockRepository.transitionGenerationRun).toHaveBeenCalledWith(
        newRun.id,
        userId,
        expect.arrayContaining(['PENDING']),
        'FAILED',
        expect.objectContaining({ errorCode: expect.any(String) }),
      );
    });

    it('updatePlan: si updatePlanTransaction rechaza, el servicio transiciona el run a FAILED antes de relanzar', async () => {
      const domainError = new Error('unexpected constraint violation inside transaction (supersede)');
      const existingPlan = { id: 'plan-1', userId, days: [] };

      mockRepository.findPlanByWeek = jest.fn().mockResolvedValue(existingPlan);
      mockRepository.createOrRecoverGenerationRun = jest.fn().mockResolvedValue({ run: newRun, wasCreated: true });
      mockRepository.updatePlanTransaction = jest.fn().mockRejectedValue(domainError);

      const dto = { weekStart: weekStartStr, days: generatedDays } as any;

      await expect(service.updatePlan(userId, dto)).rejects.toThrow(domainError);

      expect(mockRepository.transitionGenerationRun).toHaveBeenCalledWith(
        newRun.id,
        userId,
        expect.arrayContaining(['PENDING']),
        'FAILED',
        expect.objectContaining({ errorCode: expect.any(String) }),
      );
    });
  });
});
