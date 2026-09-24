import { Injectable, BadRequestException, NotFoundException, InternalServerErrorException, ConflictException } from '@nestjs/common';
import { PlansRepository } from './plans.repository';
import { GeminiService, GEMINI_PROVIDER, GEMINI_MODEL_NAME } from './gemini/gemini.service';
import { CURRENT_PROMPT_VERSION } from './gemini/prompts';
import { CreateMealPlanDto, MealPlanDayDto } from './dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NutritionProfile } from '../../generated/prisma/client';
import { buildProfileSnapshot, buildRequestSnapshot } from './generation-run-snapshot';
import { computeIdempotencyKeyHash } from '../../utils/idempotency-hash.util';

@Injectable()
export class PlansService {
  constructor(
    private readonly repository: PlansRepository,
    private readonly gemini: GeminiService
  ) {}

  private parseDateString(dateStr: string): Date {
    // Treat as UTC to avoid timezone shift
    return new Date(`${dateStr}T00:00:00Z`);
  }

  /**
   * NUT-75 Gap 2 (crítico): cuando `createOrRecoverGenerationRun` devuelve `wasCreated:false`,
   * el run recuperado no está necesariamente en un estado exitoso — puede ser un run recuperado
   * en `PENDING`/`READY_FOR_REVIEW`/`FAILED`/`REJECTED`/`EXPIRED` de un intento anterior con el
   * mismo `idempotencyKeyHash`. Asumir éxito incondicionalmente hacía que el caller cayera en
   * `getPlanByWeek`, que lanza un `NotFoundException` genérico y engañoso si nunca se persistió
   * nada (caso de un run en FAILED/REJECTED). Esta guarda distingue ambos casos: sólo un run
   * terminal-exitoso (`SUCCEEDED`/`CONFIRMED`) autoriza seguir el camino normal de lectura.
   *
   * NUT-75 Bug 2 (bloqueante, revisión externa de PR, ya corregido): con el índice único
   * PARCIAL de `generation_runs` (`WHERE status NOT IN ('FAILED','REJECTED','EXPIRED')`,
   * `migration.sql`), un run `FAILED`/`REJECTED`/`EXPIRED` ya NO ocupa el
   * `idempotencyKeyHash` para siempre: `createOrRecoverGenerationRun` ni siquiera devuelve
   * `wasCreated:false` con un run en esos estados (el `create` simplemente no choca contra el
   * índice único, porque esos estados quedan fuera de él), por lo que un reintento con el
   * mismo hash exacto crea un `GenerationRun` nuevo y sigue el flujo normal (vuelve a llamar
   * al proveedor). Este método sigue siendo correcto como defensa en profundidad para el
   * único caso que sigue participando de la unicidad sin ser un éxito terminal:
   * `PENDING`/`READY_FOR_REVIEW`, es decir, un intento realmente todavía activo/no resuelto con
   * el mismo fingerprint (`EXPIRED` ya queda excluido del índice único parcial igual que
   * `FAILED`/`REJECTED`, así que tampoco puede provocar este `ConflictException` una vez que
   * un run llega a ese estado). Ya no corresponde documentar este método como un bloqueo
   * general de reintentos.
   */
  private assertRecoveredRunIsUsable(run: { status: string; errorCode?: string | null }): void {
    if (run.status === 'SUCCEEDED' || run.status === 'CONFIRMED') {
      return;
    }

    const errorCodeSuffix = run.errorCode ? ` (errorCode: ${run.errorCode})` : '';
    throw new ConflictException(
      `A GenerationRun with the same idempotency key already exists in status ${run.status}${errorCodeSuffix}; ` +
        'refusing to silently treat it as a successful result. Retrying with the exact same request is not yet ' +
        'supported for non-terminal-success statuses (see NUT-75 design.md, known limitation).'
    );
  }

  async generateAndPersistPlan(userId: string, weekStartStr: string) {
    const weekStart = this.parseDateString(weekStartStr);

    const user = await this.repository.getUserWithProfile(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.nutritionProfile) throw new BadRequestException('User needs a nutrition profile');

    const exists = await this.repository.checkPlanExists(userId, weekStart);
    if (exists) {
      // Idempotency (coarse-grained, pre-existing): a plan already exists for this week.
      return this.getPlanByWeek(userId, weekStartStr);
    }

    const kind = 'MEAL_PLAN_INITIAL';
    const promptVersion = CURRENT_PROMPT_VERSION.version;
    const schemaVersion = CURRENT_PROMPT_VERSION.schemaVersion;

    const profileSnapshot = buildProfileSnapshot(user.nutritionProfile);
    const requestSnapshot = buildRequestSnapshot({
      kind,
      weekStart: weekStartStr,
      promptVersion,
      schemaVersion
    });
    const idempotencyKeyHash = computeIdempotencyKeyHash({ userId, kind, requestSnapshot });

    // Flujo A paso 5 (design.md): el GenerationRun se crea/recupera ANTES de invocar al
    // proveedor de IA, para que quede registro del intento aunque el proveedor nunca responda.
    const { run, wasCreated } = await this.repository.createOrRecoverGenerationRun(
      userId,
      kind,
      GEMINI_PROVIDER,
      GEMINI_MODEL_NAME,
      promptVersion,
      schemaVersion,
      requestSnapshot,
      profileSnapshot,
      idempotencyKeyHash
    );

    if (!wasCreated) {
      // AC3: misma solicitud (mismo idempotencyKeyHash) ya produjo un GenerationRun. No se
      // vuelve a invocar al proveedor de IA; se recupera el resultado ya persistido.
      // Gap 2: pero sólo si ese run terminó en éxito — de lo contrario, error honesto.
      this.assertRecoveredRunIsUsable(run);
      return this.getPlanByWeek(userId, weekStartStr);
    }

    let generatedDays;
    try {
      generatedDays = await this.gemini.generateMealPlan(user.nutritionProfile, weekStart);
    } catch (error) {
      await this.repository.transitionGenerationRun(run.id, userId, ['PENDING'], 'FAILED', {
        errorCode: 'AI_TIMEOUT'
      });
      throw error;
    }

    // Wrap in CreateMealPlanDto and validate full structure
    const dto = plainToInstance(CreateMealPlanDto, {
      weekStart: weekStartStr,
      days: generatedDays
    });

    const errors = await validate(dto);
    if (errors.length > 0) {
      await this.repository.transitionGenerationRun(run.id, userId, ['PENDING'], 'FAILED', {
        errorCode: 'AI_INVALID_SCHEMA'
      });
      // Documented recoverable failure
      throw new InternalServerErrorException('AI generated an invalid plan structure that failed domain validation');
    }

    return this.validateAndPersistPlan(userId, dto, run.id);
  }

  /**
   * `generationRunId` sólo viene definido cuando este método es invocado desde
   * `generateAndPersistPlan` (camino de generación IA real). El camino directo
   * `POST /meal-plans` (creación manual, sin proveedor de IA de por medio) queda fuera de
   * alcance de AC1-11 (design.md sección 8 / plan.md sección 6): no crea ningún GenerationRun.
   */
  async validateAndPersistPlan(userId: string, dto: CreateMealPlanDto, generationRunId?: string) {
    const weekStart = this.parseDateString(dto.weekStart);

    const user = await this.repository.getUserWithProfile(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.nutritionProfile) throw new BadRequestException('User needs a nutrition profile');

    const exists = await this.repository.checkPlanExists(userId, weekStart);
    if (exists) {
      // NUT-75 Bug 3 (no bloqueante, revisión externa de PR): si este método fue invocado con
      // un `generationRunId` ya creado (desde `generateAndPersistPlan`, tras haber llamado
      // exitosamente al proveedor de IA) y este guard dispara — por ejemplo, una creación
      // manual concurrente vía `POST /meal-plans` para la misma semana entre el momento en que
      // se creó el run y el momento en que se intenta persistir — el `GenerationRun` no debe
      // quedar colgado en `PENDING` para siempre. Mismo patrón que el catch de
      // `validateRestrictions` más abajo: try/catch silencioso alrededor de la transición, para
      // no oscurecer el error original (`BadRequestException`) si la propia limpieza falla.
      if (generationRunId) {
        try {
          await this.repository.transitionGenerationRun(generationRunId, userId, ['PENDING'], 'FAILED', {
            errorCode: 'PLAN_ALREADY_EXISTS'
          });
        } catch {
          // Ignorado deliberadamente — ver comentario equivalente más abajo en este método.
        }
      }
      throw new BadRequestException('A plan for this week already exists');
    }

    try {
      this.validateRestrictions(dto.days, user.nutritionProfile);
    } catch (error) {
      if (generationRunId) {
        await this.repository.transitionGenerationRun(generationRunId, userId, ['PENDING'], 'REJECTED', {
          errorCode: 'RESTRICTION_VIOLATION'
        });
      }
      throw error;
    }

    try {
      await this.repository.createPlanTransaction(userId, weekStart, dto.days, generationRunId);
    } catch (error) {
      // Gap 3 (alto, design.md Flujo C punto 2): si la transacción de dominio falla, el
      // GenerationRun no debe quedar colgado en PENDING para siempre — se transiciona a FAILED
      // en una operación separada, fuera de la transacción abortada. Esto NO desbloquea
      // reintentos (ver TODO de assertRecoveredRunIsUsable); es sólo trazabilidad honesta del
      // fallo.
      if (generationRunId) {
        try {
          await this.repository.transitionGenerationRun(generationRunId, userId, ['PENDING'], 'FAILED', {
            errorCode: 'DOMAIN_TRANSACTION_FAILED'
          });
        } catch {
          // Si la propia limpieza falla, no debe oscurecer el error original de la
          // transacción: se ignora silenciosamente y se prioriza re-lanzar `error`.
        }
      }
      throw error;
    }
    return this.getPlanByWeek(userId, dto.weekStart);
  }

  async deletePlan(userId: string, weekStartStr: string){
    const weekStart = this.parseDateString(weekStartStr);
    const plan = await this.getPlanByWeek(userId, weekStartStr);

    const recipeIds: string[] = [];
    for (const day of plan.days || []) {
      for (const meal of day.meals || []) {
        if (meal.recipeId) {
          recipeIds.push(meal.recipeId);
        }
      }
    }

    return this.repository.deletePlanTransaction(plan.id, recipeIds);
  }

  /**
   * Flujo D (supersede, design.md). Mapea a `GenerationKind.MEAL_PLAN_REGENERATION`. Este
   * caller no invoca hoy al proveedor de IA (persiste `dto.days` ya armado por el cliente,
   * ver plan.md sección 1), así que no hay pasos de invocación a proveedor ni `FAILED` por
   * timeout — sólo creación/recuperación del GenerationRun, validación de dominio y
   * confirmación transaccional (supersede).
   */
  async updatePlan(userId: string, dto: CreateMealPlanDto) {
    const weekStart = this.parseDateString(dto.weekStart);

    const user = await this.repository.getUserWithProfile(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.nutritionProfile) throw new BadRequestException('User needs a nutrition profile');

    const plan = await this.repository.findPlanByWeek(userId, weekStart);
    if (!plan) throw new NotFoundException('Plan not found to update');

    const kind = 'MEAL_PLAN_REGENERATION';
    const promptVersion = CURRENT_PROMPT_VERSION.version;
    const schemaVersion = CURRENT_PROMPT_VERSION.schemaVersion;

    const profileSnapshot = buildProfileSnapshot(user.nutritionProfile);
    // Gap 1 (crítico): a diferencia de MEAL_PLAN_INITIAL, esta solicitud sí trae contenido de
    // entrada propio (`dto.days`, armado por el cliente) — se incluye para que dos ediciones
    // de la misma semana con contenido distinto produzcan requestSnapshot/hash distintos.
    const requestSnapshot = buildRequestSnapshot({
      kind,
      weekStart: dto.weekStart,
      promptVersion,
      schemaVersion,
      days: dto.days
    });
    const idempotencyKeyHash = computeIdempotencyKeyHash({ userId, kind, requestSnapshot });

    const { run, wasCreated } = await this.repository.createOrRecoverGenerationRun(
      userId,
      kind,
      GEMINI_PROVIDER,
      GEMINI_MODEL_NAME,
      promptVersion,
      schemaVersion,
      requestSnapshot,
      profileSnapshot,
      idempotencyKeyHash
    );

    if (!wasCreated) {
      // AC3, aplicado a regeneración: misma solicitud ya procesada, no repetir el supersede.
      // Gap 2: sólo si ese run terminó en éxito — de lo contrario, error honesto.
      this.assertRecoveredRunIsUsable(run);
      return this.getPlanByWeek(userId, dto.weekStart);
    }

    try {
      this.validateRestrictions(dto.days, user.nutritionProfile);
    } catch (error) {
      await this.repository.transitionGenerationRun(run.id, userId, ['PENDING'], 'REJECTED', {
        errorCode: 'RESTRICTION_VIOLATION'
      });
      throw error;
    }

    try {
      await this.repository.updatePlanTransaction(userId, weekStart, dto.days, run.id);
    } catch (error) {
      // Gap 3 (alto): mismo criterio que en validateAndPersistPlan — transicionar a FAILED
      // antes de re-lanzar, sin dejar que un fallo de limpieza oscurezca el error original.
      try {
        await this.repository.transitionGenerationRun(run.id, userId, ['PENDING'], 'FAILED', {
          errorCode: 'DOMAIN_TRANSACTION_FAILED'
        });
      } catch {
        // Ignorado deliberadamente — ver comentario equivalente en validateAndPersistPlan.
      }
      throw error;
    }

    return this.getPlanByWeek(userId, dto.weekStart);
  }

  async getPlanByWeek(userId: string, weekStartStr: string) {
    const weekStart = this.parseDateString(weekStartStr);
    const plan = await this.repository.findPlanByWeek(userId, weekStart);

    if (!plan) throw new NotFoundException('Plan not found for this week');
    return plan;
  }

  private validateRestrictions(days: MealPlanDayDto[], profile: NutritionProfile) {
    if (!days || days.length !== 7) {
      throw new BadRequestException(`Plan must have exactly 7 days`);
    }

    const excluded = Array.isArray(profile.excludedIngredients)
      ? profile.excludedIngredients
      : [];
    const forbidden = excluded.map(String).map(r => r.toLowerCase());

    for (const day of days) {
      if (!day.meals || day.meals.length === 0) {
        throw new BadRequestException(`Empty meal list for day ${day.day}`);
      }

      for (const meal of day.meals) {
        // Usamos los nombres de ingredientes estructurados para validar restricciones
        const ingredientNames = meal.recipe?.ingredients?.map(i => i.name) || [];
        const textParts = [
          meal.title,
          meal.nutritionalValues?.Description || '',
          ...ingredientNames
        ];

        const textToCheck = textParts.join(' ').toLowerCase();

        for (const restriction of forbidden) {
          // Check for exact word matches or close substrings
          const regex = new RegExp(`\\b${restriction}\\b`, 'i');
          if (regex.test(textToCheck) || textToCheck.includes(restriction)) {
            throw new BadRequestException(`Meal '${meal.title}' contains excluded ingredient/concept: ${restriction}`);
          }
        }
      }
    }
  }
}
