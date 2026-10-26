import 'reflect-metadata';
import { NotFoundException, ConflictException, BadRequestException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlansService } from '../plans.service';
import { RecipeImagesService } from '../recipe-images.service';
import { DayOfWeek, MealType } from '../../../generated/prisma/client';
import { UnsplashService } from '../../unsplash/unsplash.service';
import { pendingPersistedImage, unsplashPhoto, unsplashResponse, unsplashSearchBody } from '../../unsplash/unsplash-search.fixture';

/**
 * Unit tests de PlansService con repositorio, imágenes y frontera de composición mockeados.
 * La validación/proveedor del composer se cubren en weekly-proposal.composer.spec.ts.
 */
describe('PlansService - Idempotencia y trazabilidad de GenerationRun (unit)', () => {
  let service: PlansService;
  let mockRepository: any;
  let mockComposer: any;
  let mockUnsplash: any;
  let mockConfig: any;

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
    meals: [MealType.LUNCH, MealType.BREAKFAST, MealType.SNACK, MealType.DINNER].map((mealType) => {
      const title = mealType === MealType.LUNCH ? 'Ensalada de Quinoa' : `Receta de ${mealType}`;
      return {
        mealType,
        title,
        nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Comida nutritiva' },
        recipe: {
          title,
          description: 'Receta nutritiva con quinoa y vegetales',
          prepMinutes: 10,
          cookMinutes: 15,
          ingredients: [{ name: 'Quinoa', quantity: 150, unit: 'g' }],
          instructions: ['Cocinar la quinoa', 'Mezclar con vegetales'],
        },
      };
    }),
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
  const defaultWeeklyProposal = {
    dto: { weekStart: weekStartStr, days: generatedDays },
    comparableDays: generatedDays,
    summary: { stage: 'passed', codes: [], warnings: ['CALORIE_CHECK_SKIPPED'] },
    compositionSnapshot: {
      compositionVersion: 'weekly-catalog-composition-v1',
      aiInvoked: true,
      batches: [{ mealType: MealType.BREAKFAST, count: 1, model: 'test-model', promptVersion: 'test-prompt', schemaVersion: 'test-schema' }],
    },
  };

  beforeEach(() => {
    mockComposer = {
      composeWeeklyProposal: jest.fn().mockResolvedValue(defaultWeeklyProposal),
    };

    mockRepository = {
      getUserWithProfile: jest.fn().mockResolvedValue(mockUser),
      checkPlanExists: jest.fn().mockResolvedValue(false),
      createOrRecoverGenerationRun: jest
        .fn()
        .mockResolvedValueOnce({ run: newRun, wasCreated: true })
        .mockResolvedValueOnce({ run: existingRun, wasCreated: false }),
      createPlanTransaction: jest.fn().mockResolvedValue({ planId: persistedPlan.id, recipesForTracking: [] }),
      findPlanByWeek: jest.fn().mockResolvedValue(persistedPlan),
      transitionGenerationRun: jest.fn().mockResolvedValue(1),
    };

    mockUnsplash = {
      searchAndSelectImages: jest.fn().mockImplementation(async (days: any) => days),
      trackDownload: jest.fn().mockImplementation(async (image: any) => ({
        ...image,
        tracking: { ...(image?.tracking ?? {}), status: 'SUCCEEDED', lastAttemptAt: new Date().toISOString() },
      })),
    };

    mockConfig = { get: jest.fn().mockReturnValue(undefined) };
    service = new PlansService(mockRepository, new RecipeImagesService(mockRepository, mockUnsplash), mockConfig, mockComposer);
  });

  describe('AC3 - misma solicitud no duplica ejecución', () => {
    it('compone una sola propuesta y no crea un segundo GenerationRun al repetir la misma solicitud', async () => {
      await service.generateAndPersistPlan(userId, weekStartStr);
      await service.generateAndPersistPlan(userId, weekStartStr);

      expect(mockRepository.createOrRecoverGenerationRun).toHaveBeenCalledTimes(2);
      // La segunda vez recupera el plan exitoso y no vuelve a componer una propuesta.
      expect(mockComposer.composeWeeklyProposal).toHaveBeenCalledTimes(1);
    });

    it('la segunda llamada devuelve el mismo plan persistido sin crear una fila de dominio nueva', async () => {
      const firstResult = await service.generateAndPersistPlan(userId, weekStartStr);
      const secondResult = await service.generateAndPersistPlan(userId, weekStartStr);

      expect(secondResult).toEqual(firstResult);
      // Sólo debería haber una confirmación transaccional real (la primera vez).
      expect(mockRepository.createPlanTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('AC9 - GenerationRun se crea/recupera antes de componer la propuesta', () => {
    it('resuelve createOrRecoverGenerationRun antes de invocar composeWeeklyProposal', async () => {
      const callOrder: string[] = [];

      mockRepository.createOrRecoverGenerationRun = jest.fn().mockImplementation(async () => {
        callOrder.push('createOrRecoverGenerationRun');
        return { run: newRun, wasCreated: true };
      });
      mockComposer.composeWeeklyProposal = jest.fn().mockImplementation(async () => {
        callOrder.push('composeWeeklyProposal');
        return defaultWeeklyProposal;
      });

      await service.generateAndPersistPlan(userId, weekStartStr);

      expect(callOrder).toEqual(['createOrRecoverGenerationRun', 'composeWeeklyProposal']);
    });
  });

  describe('NUT-76 - PlansService consume la propuesta semanal ya compuesta', () => {
    it('forwardea el perfil original al composer y persiste la propuesta completa con sus snapshots', async () => {
      const restrictedProfile = { ...mockNutritionProfile, excludedIngredients: ['NUTS'] };
      const originalProfile = structuredClone(restrictedProfile);
      mockRepository.getUserWithProfile.mockResolvedValue({ ...mockUser, nutritionProfile: restrictedProfile });

      await expect(service.generateAndPersistPlan(userId, weekStartStr)).resolves.toEqual(persistedPlan);

      expect(mockComposer.composeWeeklyProposal).toHaveBeenCalledWith(expect.objectContaining({
        userId,
        runId: newRun.id,
        profile: restrictedProfile,
        weekStartStr,
        weekStart: expect.any(Date),
      }));
      expect(restrictedProfile).toEqual(originalProfile);
      const [, , days, runId, origin, validationSnapshot, compositionSnapshot] = mockRepository.createPlanTransaction.mock.calls[0];
      expect(days).toEqual(generatedDays);
      expect(runId).toBe(newRun.id);
      expect(origin).toBeUndefined();
      expect(validationSnapshot).toEqual(defaultWeeklyProposal.summary);
      expect(compositionSnapshot).toEqual(defaultWeeklyProposal.compositionSnapshot);
    });

    it('manual editing accepts excluded ingredients after structural validation without invoking the composer', async () => {
      mockRepository.getUserWithProfile.mockResolvedValue({ ...mockUser, nutritionProfile: { ...mockNutritionProfile, excludedIngredients: ['NUTS'] } });
      mockRepository.updatePlanTransaction = jest.fn().mockResolvedValue({ planId: 'plan-1', recipesForTracking: [] });
      const mondayMeal = generatedDays[0].meals[0];
      const days = generatedDays.map((day, index) => index === 0
        ? { ...day, meals: [{ ...mondayMeal, recipe: { ...mondayMeal.recipe, ingredients: [{ name: 'Almendras', quantity: 30, unit: 'g' }] } }, ...day.meals.slice(1)] }
        : day);

      await service.updatePlan(userId, { weekStart: weekStartStr, days } as any);

      expect(mockRepository.updatePlanTransaction).toHaveBeenCalled();
      expect(mockComposer.composeWeeklyProposal).not.toHaveBeenCalled();
      expect(mockRepository.transitionGenerationRun).not.toHaveBeenCalledWith(newRun.id, userId, ['PENDING'], 'REJECTED', expect.anything());
    });

    it('rechaza una propuesta estructuralmente incompleta antes de buscar imágenes o persistir', async () => {
      mockComposer.composeWeeklyProposal.mockResolvedValue({
        ...defaultWeeklyProposal,
        dto: { ...defaultWeeklyProposal.dto, days: generatedDays.slice(0, 6) },
      });

      await expect(service.generateAndPersistPlan(userId, weekStartStr)).rejects.toBeInstanceOf(BadRequestException);

      expect(mockRepository.transitionGenerationRun).toHaveBeenCalledWith(newRun.id, userId, ['PENDING'], 'REJECTED', { errorCode: 'INVALID_PLAN_STRUCTURE' });
      expect(mockUnsplash.searchAndSelectImages).not.toHaveBeenCalled();
      expect(mockRepository.createPlanTransaction).not.toHaveBeenCalled();
    });

    it('propaga el 422 del composer sin hacer una escritura parcial ni sobrescribir su resultado', async () => {
      mockComposer.composeWeeklyProposal.mockRejectedValue(new UnprocessableEntityException('proposal rejected'));

      await expect(service.generateAndPersistPlan(userId, weekStartStr)).rejects.toBeInstanceOf(UnprocessableEntityException);

      expect(mockRepository.transitionGenerationRun).not.toHaveBeenCalled();
      expect(mockUnsplash.searchAndSelectImages).not.toHaveBeenCalled();
      expect(mockRepository.createPlanTransaction).not.toHaveBeenCalled();
    });
  });

  describe('NUT-74 - runs PENDING colgados (mismo TTL que NUT-77)', () => {
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

    it('un PENDING más viejo que el TTL pasa a EXPIRED y la generación se hace de cero', async () => {
      mockRepository.createOrRecoverGenerationRun = jest.fn()
        .mockResolvedValueOnce({ run: { ...newRun, id: 'run-stale', startedAt: minutesAgo(11) }, wasCreated: false })
        .mockResolvedValueOnce({ run: newRun, wasCreated: true });

      await service.generateAndPersistPlan(userId, weekStartStr);

      expect(mockRepository.transitionGenerationRun).toHaveBeenCalledWith('run-stale', userId, ['PENDING'], 'EXPIRED', { errorCode: 'PENDING_TIMEOUT' });
      expect(mockComposer.composeWeeklyProposal).toHaveBeenCalledTimes(1);
      expect(mockRepository.createPlanTransaction.mock.calls[0][3]).toBe(newRun.id);
    });

    it('un PENDING reciente sigue siendo 409 (otra generación en curso)', async () => {
      mockRepository.createOrRecoverGenerationRun = jest.fn()
        .mockResolvedValue({ run: { ...newRun, startedAt: minutesAgo(2) }, wasCreated: false });

      await expect(service.generateAndPersistPlan(userId, weekStartStr)).rejects.toBeInstanceOf(ConflictException);
      expect(mockRepository.transitionGenerationRun).not.toHaveBeenCalled();
    });

    it('usa MEAL_REPLACEMENT_PENDING_TTL_MINUTES', async () => {
      mockConfig.get.mockImplementation((key: string) => (key === 'MEAL_REPLACEMENT_PENDING_TTL_MINUTES' ? '1' : undefined));
      mockRepository.createOrRecoverGenerationRun = jest.fn()
        .mockResolvedValueOnce({ run: { ...newRun, id: 'run-stale', startedAt: minutesAgo(2) }, wasCreated: false })
        .mockResolvedValueOnce({ run: newRun, wasCreated: true });

      await service.generateAndPersistPlan(userId, weekStartStr);

      expect(mockRepository.transitionGenerationRun).toHaveBeenCalledWith('run-stale', userId, ['PENDING'], 'EXPIRED', { errorCode: 'PENDING_TIMEOUT' });
    });
  });

  describe('NUT-76 - errores del composer conservan status y limpieza del servicio', () => {
    it.each(['AI_TIMEOUT', 'AI_PROVIDER_ERROR'] as const)('%s: el 503 del composer se propaga y no se persiste un plan', async (reason) => {
      mockComposer.composeWeeklyProposal.mockRejectedValue(new ServiceUnavailableException(reason));

      await expect(service.generateAndPersistPlan(userId, weekStartStr)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(mockRepository.transitionGenerationRun).not.toHaveBeenCalled();
      expect(mockRepository.createPlanTransaction).not.toHaveBeenCalled();
    });

    it('un error inesperado del composer deja el run FAILED y sigue de largo', async () => {
      mockComposer.composeWeeklyProposal.mockRejectedValue(new TypeError('bug'));

      await expect(service.generateAndPersistPlan(userId, weekStartStr)).rejects.toThrow('bug');
      expect(mockRepository.transitionGenerationRun).toHaveBeenCalledWith(newRun.id, userId, ['PENDING'], 'FAILED', { errorCode: 'UNEXPECTED_ERROR' });
      expect(mockRepository.createPlanTransaction).not.toHaveBeenCalled();
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
      mockRepository.updatePlanTransaction = jest.fn().mockResolvedValue({ planId: 'plan-1', recipesForTracking: [] });
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
        { expectedPlanId: 'plan-1' },
      );
    });
  });

  /**
   * NUT-75 — Bug 2 (BLOQUEANTE, revisión externa de PR, cubierto por tests de esquema en
   * `apps/api/src/prisma/tests/generation-run-migration.spec.ts`, no acá): la corrección de
   * diseño ya decidida reemplaza el `@@unique([userId, kind, idempotencyKeyHash])` de
   * `GenerationRun` por un `@@index` simple + un índice único PARCIAL en SQL
   * (`WHERE status NOT IN ('FAILED', 'REJECTED', 'EXPIRED')`). Con ese cambio, un run
   * `FAILED`/`REJECTED`/`EXPIRED` deja de "ocupar" el hash de idempotencia: un reintento
   * idéntico simplemente inserta un `GenerationRun` NUEVO (otro `id`, `wasCreated: true`) en
   * vez de chocar contra el `P2002` del run terminal viejo. En la práctica, esto significa que
   * `createOrRecoverGenerationRun` con `wasCreated: false` ya NO debería poder devolver un run
   * en `FAILED`/`REJECTED`/`EXPIRED` (sólo en `PENDING`/`READY_FOR_REVIEW`/`SUCCEEDED`/
   * `CONFIRMED`, los estados que el índice parcial sigue deduplicando) — por lo que los dos
   * tests de `assertRecoveredRunIsUsable` de abajo (`Gap 2 (CRITICO)`), que mockean
   * `createOrRecoverGenerationRun` devolviendo `wasCreated: false` con un run en
   * `FAILED`/`REJECTED`, pasan a documentar un escenario que ya no debería ocurrir en
   * producción una vez aplicado el fix de Bug 2 — quedan igual como red de seguridad (defensa
   * en profundidad si algún caller futuro llama a `createOrRecoverGenerationRun` de otra forma),
   * no se eliminan ni se marcan `skip` en esta etapa.
   */
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

  /**
   * NUT-75 — Bug 3 (NO bloqueante, revisión externa de PR): en `validateAndPersistPlan`
   * (`plans.service.ts:138-180`), el guard `checkPlanExists` / `BadRequestException('A plan
   * for this week already exists')` (`plans.service.ts:145-146`) corre ANTES de cualquier
   * try/catch. Si este método es invocado con un `generationRunId` ya creado (desde
   * `generateAndPersistPlan`, tras haber creado el `GenerationRun` y llamado exitosamente a
   * OpenAI) y ese guard dispara — por ejemplo, una creación manual concurrente vía
   * `POST /meal-plans` para la misma semana entre el momento en que se creó el run y el momento
   * en que se intenta persistir — el `GenerationRun` queda en `PENDING` para siempre: nunca
   * transiciona a un estado terminal, violando `.ai/ai-generation-safety.md`
   * ("Recoverable failure state with a clear retry path").
   *
   * `.ai/ai-generation-safety.md` requiere estado de fallo recuperable; el `errorCode` exacto
   * queda a criterio del implementer (este test sólo exige que exista y sea un string).
   */
  describe('Bug 3 (NO bloqueante) - checkPlanExists dispara antes de poder marcar el GenerationRun como FAILED', () => {
    it('validateAndPersistPlan: si recibe un generationRunId y checkPlanExists devuelve true, transiciona el run a FAILED antes de lanzar BadRequestException', async () => {
      mockRepository.checkPlanExists = jest.fn().mockResolvedValue(true);
      mockRepository.transitionGenerationRun = jest.fn().mockResolvedValue(1);

      const dto = { weekStart: weekStartStr, days: generatedDays } as any;

      await expect(
        service.validateAndPersistPlan(userId, dto, 'run-concurrent-1'),
      ).rejects.toThrow(BadRequestException);

      expect(mockRepository.transitionGenerationRun).toHaveBeenCalledWith(
        'run-concurrent-1',
        userId,
        ['PENDING'],
        'FAILED',
        expect.objectContaining({ errorCode: expect.any(String) }),
      );
    });
  });

  describe('NUT-83 - integración de UnsplashService en validateAndPersistPlan (AC5 parte 2, AC13, AC14)', () => {
    it('AC14: generateAndPersistPlan (camino feliz, mismo camino que AC3/AC9) invoca unsplash.searchAndSelectImages ANTES de repository.createPlanTransaction', async () => {
      const callOrder: string[] = [];

      mockUnsplash.searchAndSelectImages = jest.fn().mockImplementation(async (days: any) => {
        callOrder.push('searchAndSelectImages');
        return days;
      });
      mockRepository.createPlanTransaction = jest.fn().mockImplementation(async () => {
        callOrder.push('createPlanTransaction');
        return { planId: persistedPlan.id, recipesForTracking: [] };
      });

      await service.generateAndPersistPlan(userId, weekStartStr);

      expect(callOrder).toEqual(['searchAndSelectImages', 'createPlanTransaction']);
    });

    it('AC13 (corregido): validateAndPersistPlan invocado SIN generationRunId (camino manual POST /meal-plans) SÍ llama a unsplash.searchAndSelectImages, antes de repository.createPlanTransaction', async () => {
      const callOrder: string[] = [];

      mockUnsplash.searchAndSelectImages = jest.fn().mockImplementation(async (days: any) => {
        callOrder.push('searchAndSelectImages');
        return days;
      });
      mockRepository.createPlanTransaction = jest.fn().mockImplementation(async () => {
        callOrder.push('createPlanTransaction');
        return { planId: persistedPlan.id, recipesForTracking: [] };
      });

      const dto = { weekStart: weekStartStr, days: generatedDays } as any;

      await service.validateAndPersistPlan(userId, dto);

      expect(callOrder).toEqual(['searchAndSelectImages', 'createPlanTransaction']);
      expect(mockUnsplash.searchAndSelectImages).toHaveBeenCalledWith(dto.days);
      expect(mockRepository.createPlanTransaction).toHaveBeenCalledWith(
        userId,
        expect.any(Date),
        dto.days,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it('AC13 (corregido): updatePlan (regeneración/edición manual, camino updatePlanTransaction) SÍ llama a unsplash.searchAndSelectImages, antes de repository.updatePlanTransaction', async () => {
      const existingPlan = { id: 'plan-1', userId, days: [] };
      mockRepository.findPlanByWeek = jest.fn().mockResolvedValue(existingPlan);
      mockRepository.createOrRecoverGenerationRun = jest
        .fn()
        .mockResolvedValue({ run: newRun, wasCreated: true });

      const callOrder: string[] = [];
      mockUnsplash.searchAndSelectImages = jest.fn().mockImplementation(async (days: any) => {
        callOrder.push('searchAndSelectImages');
        return days;
      });
      mockRepository.updatePlanTransaction = jest.fn().mockImplementation(async () => {
        callOrder.push('updatePlanTransaction');
        return { planId: 'plan-1', recipesForTracking: [] };
      });

      const dto = { weekStart: weekStartStr, days: generatedDays } as any;

      await service.updatePlan(userId, dto);

      expect(callOrder).toEqual(['searchAndSelectImages', 'updatePlanTransaction']);
      expect(mockUnsplash.searchAndSelectImages).toHaveBeenCalledWith(dto.days);
    });

    it('si la resolución de imágenes devuelve null para alguna receta del batch, generateAndPersistPlan igual completa exitosamente y persiste el plan', async () => {
      mockUnsplash.searchAndSelectImages = jest.fn().mockImplementation(async (days: any) =>
        days.map((day: any) => ({
          ...day,
          meals: day.meals.map((meal: any) => ({
            ...meal,
            recipe: meal.recipe ? { ...meal.recipe, image: null } : meal.recipe,
          })),
        })),
      );

      const result = await service.generateAndPersistPlan(userId, weekStartStr);

      expect(result).toEqual(persistedPlan);
      expect(mockRepository.createPlanTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('NUT-83 revisión de reviewers - Gap 2 (BLOQUEANTE) - fallo inesperado de unsplash.searchAndSelectImages no debe propagarse sin control', () => {
    it('generateAndPersistPlan: si unsplash.searchAndSelectImages rechaza con una excepción inesperada, el plan igual se persiste (degradación) en vez de que createPlanTransaction nunca se invoque', async () => {
      mockUnsplash.searchAndSelectImages = jest.fn().mockRejectedValue(new TypeError('bug inesperado en searchAndSelectImages'));

      const result = await service.generateAndPersistPlan(userId, weekStartStr);

      expect(result).toEqual(persistedPlan);
      expect(mockRepository.createPlanTransaction).toHaveBeenCalledTimes(1);
    });

    it('updatePlan: si unsplash.searchAndSelectImages rechaza con una excepción inesperada, el plan igual se persiste (degradación) en vez de que updatePlanTransaction nunca se invoque', async () => {
      const existingPlan = { id: 'plan-1', userId, days: [] };
      mockRepository.findPlanByWeek = jest.fn().mockResolvedValue(existingPlan);
      mockRepository.createOrRecoverGenerationRun = jest
        .fn()
        .mockResolvedValue({ run: newRun, wasCreated: true });
      mockRepository.updatePlanTransaction = jest.fn().mockResolvedValue({ planId: 'plan-1', recipesForTracking: [] });
      mockUnsplash.searchAndSelectImages = jest.fn().mockRejectedValue(new TypeError('bug inesperado en searchAndSelectImages'));

      const dto = { weekStart: weekStartStr, days: generatedDays } as any;

      const result = await service.updatePlan(userId, dto);

      expect(result).toEqual(persistedPlan);
      expect(mockRepository.updatePlanTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('NUT-83 - registro de uso post-persistencia se invoca DESPUÉS de la transacción (design.md 6.3)', () => {
    const pendingImage = pendingPersistedImage();

    it('generateAndPersistPlan: invoca unsplash.trackDownload para la receta nueva DESPUÉS de que createPlanTransaction ya resolvió (nunca antes, nunca durante)', async () => {
      const callOrder: string[] = [];

      mockRepository.createPlanTransaction = jest.fn().mockImplementation(async () => {
        callOrder.push('createPlanTransaction');
        return { planId: persistedPlan.id, recipesForTracking: [{ recipeId: 'recipe-1', image: pendingImage }] };
      });
      mockUnsplash.trackDownload = jest.fn().mockImplementation(async (image: any) => {
        callOrder.push('trackDownload');
        return { ...image, tracking: { ...image.tracking, status: 'SUCCEEDED', lastAttemptAt: '2026-10-01T00:00:00.000Z' } };
      });

      await service.generateAndPersistPlan(userId, weekStartStr);

      expect(callOrder).toEqual(['createPlanTransaction', 'trackDownload']);
    });

    it('validateAndPersistPlan (camino manual, sin generationRunId): mismo orden createPlanTransaction -> trackDownload', async () => {
      const callOrder: string[] = [];

      mockRepository.createPlanTransaction = jest.fn().mockImplementation(async () => {
        callOrder.push('createPlanTransaction');
        return { planId: persistedPlan.id, recipesForTracking: [{ recipeId: 'recipe-1', image: pendingImage }] };
      });
      mockUnsplash.trackDownload = jest.fn().mockImplementation(async (image: any) => {
        callOrder.push('trackDownload');
        return image;
      });

      const dto = { weekStart: weekStartStr, days: generatedDays } as any;
      await service.validateAndPersistPlan(userId, dto);

      expect(callOrder).toEqual(['createPlanTransaction', 'trackDownload']);
    });

    it('updatePlan: invoca unsplash.trackDownload DESPUÉS de que updatePlanTransaction ya resolvió', async () => {
      const existingPlan = { id: 'plan-1', userId, days: [] };
      mockRepository.findPlanByWeek = jest.fn().mockResolvedValue(existingPlan);
      mockRepository.createOrRecoverGenerationRun = jest.fn().mockResolvedValue({ run: newRun, wasCreated: true });

      const callOrder: string[] = [];
      mockRepository.updatePlanTransaction = jest.fn().mockImplementation(async () => {
        callOrder.push('updatePlanTransaction');
        return { planId: 'plan-1', recipesForTracking: [{ recipeId: 'recipe-1', image: pendingImage }] };
      });
      mockUnsplash.trackDownload = jest.fn().mockImplementation(async (image: any) => {
        callOrder.push('trackDownload');
        return image;
      });

      const dto = { weekStart: weekStartStr, days: generatedDays } as any;
      await service.updatePlan(userId, dto);

      expect(callOrder).toEqual(['updatePlanTransaction', 'trackDownload']);
    });

    it('generateAndPersistPlan: cuando recipesForTracking viene vacío (plan sin recetas nuevas, todas reusadas), nunca invoca unsplash.trackDownload', async () => {
      mockRepository.createPlanTransaction = jest.fn().mockResolvedValue({ planId: persistedPlan.id, recipesForTracking: [] });
      mockUnsplash.trackDownload = jest.fn();

      await service.generateAndPersistPlan(userId, weekStartStr);

      expect(mockUnsplash.trackDownload).not.toHaveBeenCalled();
    });

    it('updatePlan: cuando recipesForTracking viene vacío, nunca invoca unsplash.trackDownload', async () => {
      const existingPlan = { id: 'plan-1', userId, days: [] };
      mockRepository.findPlanByWeek = jest.fn().mockResolvedValue(existingPlan);
      mockRepository.createOrRecoverGenerationRun = jest.fn().mockResolvedValue({ run: newRun, wasCreated: true });
      mockRepository.updatePlanTransaction = jest.fn().mockResolvedValue({ planId: 'plan-1', recipesForTracking: [] });
      mockUnsplash.trackDownload = jest.fn();

      const dto = { weekStart: weekStartStr, days: generatedDays } as any;
      await service.updatePlan(userId, dto);

      expect(mockUnsplash.trackDownload).not.toHaveBeenCalled();
    });
  });

  describe('NUT-83 - getPlanByWeek filtra metadata privada de tracking antes de devolver el plan (design.md 5.4)', () => {
    const rawImage = pendingPersistedImage({ tracking: { status: 'SUCCEEDED', lastAttemptAt: '2026-09-30T12:05:00.000Z' } });

    it('cada recipe.image llega sin la clave "tracking", aunque el repositorio devuelva el image crudo con tracking', async () => {
      const planWithRawImage = {
        id: 'plan-1',
        userId,
        days: [
          {
            id: 'day-1',
            meals: [
              {
                id: 'meal-1',
                recipeId: 'recipe-1',
                recipe: { id: 'recipe-1', title: 'Ensalada de Quinoa', image: rawImage },
              },
            ],
          },
        ],
      };
      mockRepository.findPlanByWeek = jest.fn().mockResolvedValue(planWithRawImage);

      const result = await service.getPlanByWeek(userId, weekStartStr);

      const filteredImage = (result as any).days[0].meals[0].recipe.image;
      expect(filteredImage.tracking).toBeUndefined();
      expect(Object.keys(filteredImage).sort()).toEqual(
        ['alt', 'imageUrl', 'photographer', 'photographerUrl', 'provider', 'providerPhotoId', 'query', 'retrievedAt', 'sourceUrl'].sort(),
      );
      // El resto del contenido de la receta sigue presente sin cambios.
      expect((result as any).days[0].meals[0].recipe.title).toBe('Ensalada de Quinoa');
    });

    it('una receta con image: null sigue devolviendo image: null sin lanzar', async () => {
      const planWithNullImage = {
        id: 'plan-1',
        userId,
        days: [
          {
            id: 'day-1',
            meals: [{ id: 'meal-1', recipeId: 'recipe-1', recipe: { id: 'recipe-1', title: 'Ensalada de Quinoa', image: null } }],
          },
        ],
      };
      mockRepository.findPlanByWeek = jest.fn().mockResolvedValue(planWithNullImage);

      const result = await service.getPlanByWeek(userId, weekStartStr);

      expect((result as any).days[0].meals[0].recipe.image).toBeNull();
    });
  });
});

describe('PlansService - NUT-83: búsqueda y registro de uso con UnsplashService REAL (design.md 6.3)', () => {
  const MOCK_API_KEY = 'test-unsplash-key-plan-integration';
  const userId = 'user-real-unsplash-1';
  const weekStartStr = '2026-09-14';

  const mockNutritionProfile = {
    id: 'profile-real-1',
    userId,
    goal: 'LOSE_WEIGHT',
    diet: 'VEGAN',
    excludedIngredients: [],
    cookTimePreference: 'QUICK',
  };

  const mockUser = { id: userId, nutritionProfile: mockNutritionProfile };

  const buildDay = (day: DayOfWeek, date: string, title: string) => ({
    day,
    date,
    meals: [
      {
        mealType: MealType.LUNCH,
        title,
        nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Almuerzo' },
        recipe: {
          title,
          description: 'Receta de prueba',
          prepMinutes: 10,
          cookMinutes: 15,
          ingredients: [{ name: 'Ingrediente', quantity: 100, unit: 'g' }],
          instructions: ['Paso unico'],
        },
      },
    ],
  });

  const sevenValidDays = [
    buildDay(DayOfWeek.MONDAY, '2026-09-14', 'Ensalada de Quinoa'),
    buildDay(DayOfWeek.TUESDAY, '2026-09-15', 'Tacos de Pollo'),
    buildDay(DayOfWeek.WEDNESDAY, '2026-09-16', 'Sopa de Lentejas'),
    buildDay(DayOfWeek.THURSDAY, '2026-09-17', 'Arroz con Vegetales'),
    buildDay(DayOfWeek.FRIDAY, '2026-09-18', 'Pasta Integral'),
    buildDay(DayOfWeek.SATURDAY, '2026-09-19', 'Pollo al Horno'),
    buildDay(DayOfWeek.SUNDAY, '2026-09-20', 'Pescado a la Plancha'),
  ];

  const candidate = unsplashPhoto('planReal001');

  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('validateAndPersistPlan (camino manual, sin generationRunId) NUNCA dispara un fetch a download_location antes de que repository.createPlanTransaction sea invocado', async () => {
    const callOrder: string[] = [];

    const fetchMock = jest.fn((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('/search/photos')) {
        callOrder.push('searchFetch');
        return Promise.resolve(unsplashResponse(unsplashSearchBody([candidate])));
      }
      if (urlStr.includes('/download')) {
        callOrder.push('downloadFetch');
        return Promise.resolve(unsplashResponse({}));
      }
      return Promise.reject(new Error(`fetch inesperado en el test: ${urlStr}`));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const configService = {
      get: jest.fn((key: string) => (key === 'UNSPLASH_ACCESS_KEY' ? MOCK_API_KEY : undefined)),
    } as unknown as ConfigService;
    const realUnsplash = new UnsplashService(configService);

    const mockRepository: any = {
      getUserWithProfile: jest.fn().mockResolvedValue(mockUser),
      checkPlanExists: jest.fn().mockResolvedValue(false),
      // Igual que el repositorio real: informa las recetas creadas cuya imagen tiene tracking.
      createPlanTransaction: jest.fn().mockImplementation(async (_userId: string, _weekStart: Date, days: any[]) => {
        callOrder.push('createPlanTransaction');
        const recipesForTracking = days.flatMap((day: any, dayIndex: number) =>
          day.meals
            .filter((meal: any) => meal.recipe?.image?.tracking)
            .map((meal: any) => ({ recipeId: `recipe-${dayIndex}`, image: meal.recipe.image })),
        );
        return { planId: 'plan-real-1', recipesForTracking };
      }),
      updateRecipeImageTracking: jest.fn().mockResolvedValue(undefined),
      findPlanByWeek: jest.fn().mockResolvedValue({ id: 'plan-real-1', userId, days: [] }),
    };

    const service = new PlansService(mockRepository, new RecipeImagesService(mockRepository, realUnsplash), {} as any, {} as any);

    const dto = { weekStart: weekStartStr, days: sevenValidDays } as any;
    await service.validateAndPersistPlan(userId, dto);

    expect(callOrder).toContain('createPlanTransaction');
    const transactionIndex = callOrder.indexOf('createPlanTransaction');
    const downloadIndexes = callOrder
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry === 'downloadFetch')
      .map(({ index }) => index);

    expect(callOrder.indexOf('searchFetch')).toBeLessThan(transactionIndex);
    // Siete títulos distintos, una sola foto: un solo evento, después de la transacción.
    expect(downloadIndexes).toHaveLength(1);
    for (const downloadIndex of downloadIndexes) {
      expect(downloadIndex).toBeGreaterThan(transactionIndex);
    }
  });
});
