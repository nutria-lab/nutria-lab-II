import 'reflect-metadata';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
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
  let mockPexels: any;

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

    // NUT-83 (design.md D1/D2/D3, plan.md sección 4.3): mock plano de PexelsService, inyectado
    // como propiedad de instancia después de construir el servicio (no como tercer argumento
    // posicional del constructor). Esto evita que este archivo dependa de que el implementer ya
    // haya cambiado la firma del constructor de PlansService — la inyección por propiedad
    // funciona igual antes y después de ese cambio, y sigue probando el comportamiento real una
    // vez que `PlansService` empiece a leer `this.pexels` (nombre de campo asumido según el
    // propio ejemplo de código de plan.md sección 4.3: `this.pexels.attachImages(dto.days)`).
    //
    // Decisión de integración para estos tests (pedida explícitamente por el prompt de esta
    // etapa, "decidilo con criterio y documentalo"): se mockea un orquestador de batch,
    // `pexels.attachImages(days)`, en vez de `pexels.resolveImage(title)` por receta. Razón:
    // `attachImages` es el punto de integración exacto que propone plan.md sección 4.3 dentro de
    // `validateAndPersistPlan` (una sola llamada por generación, antes de la transacción), y
    // mockear ese único método hace triviales de expresar los casos de "nunca se llama" (AC13) y
    // "se llama antes que la transacción" (AC14) sin acoplar este archivo a los detalles de
    // concurrencia acotada de `resolveWithBoundedConcurrency` (ya cubiertos en aislamiento por
    // `pexels-concurrency.spec.ts`, etapa anterior).
    mockPexels = {
      attachImages: jest.fn().mockImplementation(async (days: any) => days),
    };

    // NUT-83 revisión de reviewers (punto 3, autorizado explícitamente para este archivo):
    // se pasa `mockPexels` como tercer argumento posicional del constructor en vez de
    // inyectarlo por propiedad de instancia después de construir (`(service as
    // any).pexels = mockPexels`). El monkey-patching anterior ocultaba que el constructor
    // real de `PlansService` todavía declara `pexels` como opcional (`pexels?:
    // PexelsService`) y lo usa con `this.pexels!` — este cambio habilita al implementer a
    // hacer el parámetro obligatorio (sin `?`, sin `this.pexels!`) sin romper este archivo.
    service = new PlansService(mockRepository, mockGemini, mockPexels);
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
   * Gemini) y ese guard dispara — por ejemplo, una creación manual concurrente vía
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

  /**
   * NUT-83 (design.md D1 corregido/D2/D3, AC5 parte 2, AC13 corregido, AC14) — integración de
   * la resolución de imágenes de Pexels en los dos puntos exactos que propone plan.md sección
   * 10.1: dentro de `validateAndPersistPlan` y dentro de `updatePlan`, SIEMPRE (sin condicionar
   * a que `generationRunId` esté definido), ANTES de invocar `repository.createPlanTransaction`
   * / `repository.updatePlanTransaction` respectivamente. D1 fue corregida por la dueña del
   * ticket: la resolución de imagen aplica a TODA receta nueva, sin importar `origin` (IA o
   * manual) ni el camino de creación (generación inicial, edición/regeneración de plan, o
   * creación manual individual) — ya no hay ninguna condición de `generationRunId` que excluya
   * el camino manual.
   *
   * Todos los tests de este describe deben fallar en rojo hasta que el implementer agregue la
   * llamada a `this.pexels.attachImages(...)` (sin condición) tanto en `validateAndPersistPlan`
   * como en `updatePlan`. El test de "null no rompe nada" ya pasa hoy porque el código actual
   * simplemente no conoce a Pexels todavía — queda documentado igual como guarda de
   * no-regresión para después de la integración.
   */
  describe('NUT-83 - integración de PexelsService en validateAndPersistPlan (AC5 parte 2, AC13, AC14)', () => {
    it('AC14: generateAndPersistPlan (camino feliz, mismo camino que AC3/AC9) invoca pexels.attachImages ANTES de repository.createPlanTransaction', async () => {
      const callOrder: string[] = [];

      mockPexels.attachImages = jest.fn().mockImplementation(async (days: any) => {
        callOrder.push('attachImages');
        return days;
      });
      mockRepository.createPlanTransaction = jest.fn().mockImplementation(async () => {
        callOrder.push('createPlanTransaction');
        return persistedPlan.id;
      });

      await service.generateAndPersistPlan(userId, weekStartStr);

      expect(callOrder).toEqual(['attachImages', 'createPlanTransaction']);
    });

    it('AC13 (corregido): validateAndPersistPlan invocado SIN generationRunId (camino manual POST /meal-plans) SÍ llama a pexels.attachImages, antes de repository.createPlanTransaction', async () => {
      const callOrder: string[] = [];

      mockPexels.attachImages = jest.fn().mockImplementation(async (days: any) => {
        callOrder.push('attachImages');
        return days;
      });
      mockRepository.createPlanTransaction = jest.fn().mockImplementation(async () => {
        callOrder.push('createPlanTransaction');
        return persistedPlan.id;
      });

      const dto = { weekStart: weekStartStr, days: generatedDays } as any;

      await service.validateAndPersistPlan(userId, dto);

      expect(callOrder).toEqual(['attachImages', 'createPlanTransaction']);
      expect(mockPexels.attachImages).toHaveBeenCalledWith(dto.days);
      expect(mockRepository.createPlanTransaction).toHaveBeenCalledWith(
        userId,
        expect.any(Date),
        dto.days,
        undefined,
      );
    });

    it('AC13 (corregido): updatePlan (regeneración/edición manual, camino updatePlanTransaction) SÍ llama a pexels.attachImages, antes de repository.updatePlanTransaction', async () => {
      const existingPlan = { id: 'plan-1', userId, days: [] };
      mockRepository.findPlanByWeek = jest.fn().mockResolvedValue(existingPlan);
      mockRepository.createOrRecoverGenerationRun = jest
        .fn()
        .mockResolvedValue({ run: newRun, wasCreated: true });

      const callOrder: string[] = [];
      mockPexels.attachImages = jest.fn().mockImplementation(async (days: any) => {
        callOrder.push('attachImages');
        return days;
      });
      mockRepository.updatePlanTransaction = jest.fn().mockImplementation(async () => {
        callOrder.push('updatePlanTransaction');
        return 'plan-1';
      });

      const dto = { weekStart: weekStartStr, days: generatedDays } as any;

      await service.updatePlan(userId, dto);

      expect(callOrder).toEqual(['attachImages', 'updatePlanTransaction']);
      expect(mockPexels.attachImages).toHaveBeenCalledWith(dto.days);
    });

    it('si la resolución de imágenes devuelve null para alguna receta del batch, generateAndPersistPlan igual completa exitosamente y persiste el plan', async () => {
      mockPexels.attachImages = jest.fn().mockImplementation(async (days: any) =>
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

  /**
   * NUT-83 revisión de reviewers — Gap 2 (BLOQUEANTE, confirmado independientemente por los
   * 4 revisores): ninguno de los dos call sites que invocan `this.pexels.attachImages(...)`
   * (dentro de `validateAndPersistPlan` y de `updatePlan`) tiene un try/catch de respaldo.
   * `resolveImage` individual está diseñado para nunca lanzar (design.md sección 4), pero
   * `attachImages` en sí (el orquestador de batch, `resolveWithBoundedConcurrency` +
   * memoización) es código propio nuevo que SÍ puede tener un bug no contemplado (ej. un
   * `TypeError` por un acceso a propiedad inesperado) — y hoy ese rechazo se propaga sin
   * control, haciendo que `createPlanTransaction`/`updatePlanTransaction` nunca se invoque
   * y que la generación/confirmación del plan falle por una causa que design.md Flujo B
   * dice explícitamente que NUNCA debe hacer fallar la persistencia del plan ("La
   * generación/confirmación del plan nunca falla por un problema de Pexels").
   *
   * DECISIÓN DE TEST (pedida explícitamente por el prompt de esta etapa, "elegí UNA
   * interpretación, documentala con claridad, y sé consistente entre generateAndPersistPlan/
   * updatePlan"): se elige la interpretación de DEGRADACIÓN, no la de FAILED. Razonamiento:
   * design.md D4/Flujo B ya establecen como principio general del feature completo que
   * ningún fallo de Pexels (key ausente, timeout, 429, 5xx, JSON inválido, y por extensión
   * cualquier bug interno del propio orquestador de batch que hoy no está contemplado en la
   * tabla de la sección 4) debe impedir que el plan se persista — la tabla de resiliencia de
   * design.md sección 4 es exhaustiva sobre los fallos del *adaptador HTTP* (`resolveImage`),
   * pero el espíritu de diseño ("Pexels es explícitamente opcional... la receta sigue siendo
   * válida aunque el proveedor no esté disponible", design.md D4) se extiende naturalmente al
   * orquestador que lo envuelve: un bug en `attachImages` es, para efectos de persistencia,
   * un fallo más del "proveedor de imágenes" en sentido amplio, no un fallo de dominio del
   * plan en sí (a diferencia de, por ejemplo, un rechazo de `createPlanTransaction`, que Gap 3
   * de NUT-75 sí trata como FAILED porque ahí sí falló la escritura de dominio real). Tratarlo
   * como FAILED sería además inconsistente con AC5/AC6/AC7/AC8/AC9 de design.md, que ya exigen
   * degradación silenciosa (`image: null`) para toda esa misma familia de fallos cuando
   * ocurren dentro de `resolveImage`; no hay ninguna razón de diseño para que el mismo tipo de
   * fallo (Pexels no puede resolver imágenes para este batch) tenga dos desenlaces opuestos
   * según en qué capa interna ocurra el error.
   *
   * Comportamiento exigido por estos tests: si `pexels.attachImages` rechaza con una
   * excepción inesperada, el servicio la atrapa, continúa usando `dto.days` SIN imágenes
   * resueltas para ese batch (degradación equivalente a que cada receta reciba `image:
   * null`/ausente) y de todas formas invoca `createPlanTransaction`/`updatePlanTransaction`
   * — el plan se persiste igual. Estos tests deben fallar en rojo hasta que el implementer
   * envuelva la llamada a `this.pexels.attachImages(...)` en un try/catch (en ambos call
   * sites) que, ante cualquier rechazo, seguya adelante con `dto.days` en vez de relanzar.
   */
  describe('NUT-83 revisión de reviewers - Gap 2 (BLOQUEANTE) - fallo inesperado de pexels.attachImages no debe propagarse sin control', () => {
    it('generateAndPersistPlan: si pexels.attachImages rechaza con una excepción inesperada, el plan igual se persiste (degradación) en vez de que createPlanTransaction nunca se invoque', async () => {
      mockPexels.attachImages = jest.fn().mockRejectedValue(new TypeError('bug inesperado en attachImages'));

      const result = await service.generateAndPersistPlan(userId, weekStartStr);

      expect(result).toEqual(persistedPlan);
      expect(mockRepository.createPlanTransaction).toHaveBeenCalledTimes(1);
    });

    it('updatePlan: si pexels.attachImages rechaza con una excepción inesperada, el plan igual se persiste (degradación) en vez de que updatePlanTransaction nunca se invoque', async () => {
      const existingPlan = { id: 'plan-1', userId, days: [] };
      mockRepository.findPlanByWeek = jest.fn().mockResolvedValue(existingPlan);
      mockRepository.createOrRecoverGenerationRun = jest
        .fn()
        .mockResolvedValue({ run: newRun, wasCreated: true });
      mockRepository.updatePlanTransaction = jest.fn().mockResolvedValue('plan-1');
      mockPexels.attachImages = jest.fn().mockRejectedValue(new TypeError('bug inesperado en attachImages'));

      const dto = { weekStart: weekStartStr, days: generatedDays } as any;

      const result = await service.updatePlan(userId, dto);

      expect(result).toEqual(persistedPlan);
      expect(mockRepository.updatePlanTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
