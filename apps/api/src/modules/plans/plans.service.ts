import {
  Injectable,
  BadRequestException,
  HttpException,
  NotFoundException,
  ConflictException,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PlansRepository } from './plans.repository';
import { AiProviderUnavailableError, GeminiService, GEMINI_PROVIDER, GEMINI_MODEL_NAME } from './gemini/gemini.service';
import { parseJsonOutput } from '../recipe/validation/parse-generated-output';
import { CURRENT_PROMPT_VERSION } from './gemini/prompts';
import { CreateMealPlanDto, MealDto, MealPlanDayDto } from './dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NutritionProfile } from '../../generated/prisma/client';
import { buildProfileSnapshot, buildRequestSnapshot } from './generation-run-snapshot';
import { computeIdempotencyKeyHash } from '../../utils/idempotency-hash.util';
import { ConfigService } from '@nestjs/config';
import { findExcludedIngredient, forbiddenRestrictions, restrictionTexts } from '../recipe/validation/ingredient-dictionary';
import { reusableDuplicate, reusableRecipeId, summarizeParseFailure, summarizeResults } from '../recipe/validation/validate-recipe';
import type { RecipeDraft, ValidationResult, ValidationSummary } from '../recipe/validation/recipe-validation.types';
import { isStalePendingRun } from './generation-run-ttl';
import { RecipeValidationService, mealToDraftInput, type ValidatedRun } from './recipe-validation.service';
import { UnsplashService, resolveWithBoundedConcurrency, toPublicRecipeImage } from '@/modules/unsplash/unsplash.service';
import type { PersistedRecipeImage } from '@/modules/unsplash/recipe-image.types';
import type { RecipeForTracking } from './plans.repository';

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private readonly repository: PlansRepository,
    private readonly gemini: GeminiService,
    private readonly unsplash: UnsplashService,
    private readonly validation: RecipeValidationService,
    private readonly config: ConfigService,
  ) {}

  // Prepara las recetas antes de buscar imágenes:
  // - descarta cualquier `image` que venga en el payload o de la IA (nunca se confía en eso);
  // - en el PUT, si el id de la receta está en el plan actual, le copia la imagen guardada.
  // Devuelve también esas imágenes conservadas, para después no registrar su uso de nuevo.
  private prepareRecipeImages(
    days: MealPlanDayDto[],
    currentPlan?: { days?: Array<{ meals?: Array<{ recipe?: { id: string; image?: unknown } | null }> }> } | null,
  ): { days: MealPlanDayDto[]; preservedImages: Set<unknown> } {
    const persistedImageById = new Map<string, unknown>();
    for (const day of currentPlan?.days ?? []) {
      for (const meal of day.meals ?? []) {
        if (meal.recipe) {
          persistedImageById.set(meal.recipe.id, meal.recipe.image ?? null);
        }
      }
    }

    const preservedImages = new Set<unknown>();
    const preparedDays = days.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => {
        if (!meal.recipe) {
          return meal;
        }
        const recipe: MealPlanDayDto['meals'][number]['recipe'] & { image?: unknown } = { ...meal.recipe };
        delete recipe.image;

        if (recipe.id && persistedImageById.has(recipe.id)) {
          const image = persistedImageById.get(recipe.id);
          if (image) {
            preservedImages.add(image);
          }
          return { ...meal, recipe: { ...recipe, image } };
        }
        return { ...meal, recipe };
      }),
    }));

    return { days: preparedDays, preservedImages };
  }

  // Busca las imágenes del plan. Si algo falla de forma inesperada, el plan se guarda sin imágenes.
  private async resolveImagesOrDegrade(days: MealPlanDayDto[]): Promise<MealPlanDayDto[]> {
    try {
      return await this.unsplash.searchAndSelectImages(days);
    } catch (error: any) {
      this.logger.error(
        `Image search failed unexpectedly (bug, not a routine provider failure); continuing without resolved images: ${error?.message ?? 'unknown error'}`,
        error?.stack
      );
      return days;
    }
  }

  // Después de guardar el plan: registra el uso de cada foto nueva (un evento por foto, de a 3 en
  // paralelo) y guarda el resultado en cada receta.
  private async trackNewRecipeImages(recipesForTracking: RecipeForTracking[]): Promise<void> {
    const recipesByTrackingUrl = new Map<string, RecipeForTracking[]>();
    for (const item of recipesForTracking) {
      const group = recipesByTrackingUrl.get(item.image.tracking.trackingUrl) ?? [];
      group.push(item);
      recipesByTrackingUrl.set(item.image.tracking.trackingUrl, group);
    }

    await resolveWithBoundedConcurrency(Array.from(recipesByTrackingUrl.values()), async (group) => {
      // El repositorio no conoce el tipo de Unsplash (ver plans-transaction-no-network.spec.ts).
      const { tracking } = await this.unsplash.trackDownload(group[0].image as unknown as PersistedRecipeImage);
      for (const item of group) {
        await this.repository.updateRecipeImageTracking(item.recipeId, { ...item.image, tracking });
      }
    });
  }

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
    const createOrRecoverRun = () => this.repository.createOrRecoverGenerationRun(
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
    let { run, wasCreated } = await createOrRecoverRun();

    // NUT-74: un intento anterior quedó colgado (mismo TTL que NUT-77): se lo marca EXPIRED, lo que
    // libera la clave, y se genera de cero. Sin esto, la semana quedaría bloqueada con un 409.
    if (!wasCreated && isStalePendingRun(run, this.config)) {
      await this.repository.transitionGenerationRun(run.id, userId, ['PENDING'], 'EXPIRED', { errorCode: 'PENDING_TIMEOUT' });
      ({ run, wasCreated } = await createOrRecoverRun());
    }

    if (!wasCreated) {
      // AC3: misma solicitud (mismo idempotencyKeyHash) ya produjo un GenerationRun. No se
      // vuelve a invocar al proveedor de IA; se recupera el resultado ya persistido.
      // Gap 2: pero sólo si ese run terminó en éxito — de lo contrario, error honesto.
      this.assertRecoveredRunIsUsable(run);
      return this.getPlanByWeek(userId, weekStartStr);
    }

    // Desde acá, un error inesperado deja el run FAILED (nunca PENDING). Los HttpException ya
    // registraron su propio resultado (REJECTED, FAILED por proveedor, etc.).
    try {
      return await this.generateForRun(userId, weekStartStr, weekStart, user.nutritionProfile, run.id);
    } catch (error) {
      if (!(error instanceof HttpException)) {
        await this.failRun(run.id, userId, 'FAILED', 'UNEXPECTED_ERROR');
      }
      throw error;
    }
  }

  private async generateForRun(userId: string, weekStartStr: string, weekStart: Date, profile: NutritionProfile, runId: string) {
    let raw: string;
    try {
      raw = await this.gemini.generateMealPlan(profile, weekStart);
    } catch (error) {
      // NUT-74: proveedor caído o timeout → 503; cualquier otro error es un bug y sigue de largo.
      if (error instanceof AiProviderUnavailableError) {
        await this.failRun(runId, userId, 'FAILED', error.reason);
        throw new ServiceUnavailableException('The AI provider is not available; retry later');
      }
      throw error;
    }

    const run = { id: runId, userId, provider: GEMINI_PROVIDER, model: GEMINI_MODEL_NAME };
    const { days, results, summary } = await this.validateGeneratedDays(raw, profile, run);

    // Envoltorio del plan (7 días, fechas, mealType, macros de la comida) con las recetas ya
    // normalizadas, también las de los duplicados que se van a reutilizar.
    const dto = plainToInstance(CreateMealPlanDto, {
      weekStart: weekStartStr,
      days: mapMeals(days, (meal, index) => {
        const recipe = normalizedRecipeOf(results[index]);
        return recipe ? { ...(meal as object), recipe: recipeFields(recipe) } : meal;
      }),
    });

    const errors = await validate(dto);
    if (errors.length > 0) {
      await this.validation.rejectWithCode(run, 'AI_INVALID_SCHEMA');
      throw new UnprocessableEntityException('The generated meal plan did not pass validation (AI_INVALID_SCHEMA)');
    }

    // Duplicado exacto del catálogo: la comida apunta a esa receta (no se crea otra ni se busca su foto).
    dto.days = mapMeals(dto.days, (meal, index) => {
      const reuseRecipeId = reusableRecipeId(results[index]);
      if (!reuseRecipeId) return meal;
      const { recipe, ...mealWithoutRecipe } = meal as MealDto;
      return { ...mealWithoutRecipe, reuseRecipeId };
    }) as MealPlanDayDto[];

    return this.validateAndPersistPlan(userId, dto, runId, { ...summary });
  }

  /**
   * NUT-74: el servidor valida cada comida generada; la IA nunca es la autoridad final. Si el
   * output no se puede leer o alguna comida es inválida, se rechaza el plan entero (no hay todavía
   * una forma de cubrir el hueco de una comida descartada, ver design.md §3): run REJECTED y 422,
   * sin escribir dominio. Un duplicado exacto del catálogo no es un rechazo: se reutiliza.
   */
  private async validateGeneratedDays(
    raw: string,
    profile: NutritionProfile,
    run: ValidatedRun,
  ): Promise<{ days: unknown[]; results: ValidationResult[]; summary: ValidationSummary }> {
    const parsed = parseJsonOutput(raw);
    if (!parsed.ok) {
      await this.validation.reject(run, summarizeParseFailure(parsed.errors));
      throw new UnprocessableEntityException(`The generated meal plan did not pass validation (${parsed.errors[0].code})`);
    }

    const days = (parsed.value as { days?: unknown }).days;
    if (!Array.isArray(days)) {
      const missingDays: ValidationResult = { valid: false, errors: [{ code: 'MISSING_FIELD', field: 'days', message: 'The plan has no days' }] };
      await this.validation.reject(run, summarizeResults([missingDays]));
      throw new UnprocessableEntityException('The generated meal plan did not pass validation (MISSING_FIELD)');
    }

    const results = await this.validation.validateDrafts(flattenMeals(days).map(mealToDraftInput), profile);

    const rejected = results.filter(result => !result.valid && !reusableRecipeId(result));
    if (rejected.length > 0) {
      const rejection = summarizeResults(rejected);
      await this.validation.reject(run, rejection);
      throw new UnprocessableEntityException(`The generated meal plan did not pass validation (${rejection.codes[0]})`);
    }
    return { days, results, summary: summarizeResults(results) };
  }

  /**
   * `generationRunId` sólo viene definido cuando este método es invocado desde
   * `generateAndPersistPlan` (camino de generación IA real). El camino directo
   * `POST /meal-plans` (creación manual, sin proveedor de IA de por medio) queda fuera de
   * alcance de AC1-11 (design.md sección 8 / plan.md sección 6): no crea ningún GenerationRun.
   * `validationSnapshot` es el resumen de NUT-74, que se guarda al confirmar el run.
   */
  async validateAndPersistPlan(
    userId: string,
    dto: CreateMealPlanDto,
    generationRunId?: string,
    validationSnapshot?: Record<string, unknown>,
  ) {
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
        await this.failRun(generationRunId, userId, 'REJECTED', 'RESTRICTION_VIOLATION');
      }
      throw error;
    }

    // Imágenes: se buscan ANTES de la transacción (nunca hay llamadas externas dentro de ella).
    const { days: preparedDays } = this.prepareRecipeImages(dto.days);
    const daysForPersistence = await this.resolveImagesOrDegrade(preparedDays);

    let recipesForTracking: RecipeForTracking[] = [];
    try {
      const persisted = await this.repository.createPlanTransaction(
        userId, weekStart, daysForPersistence, generationRunId, undefined, validationSnapshot,
      );
      recipesForTracking = persisted.recipesForTracking;
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

    // Fuera del try/catch: un fallo de tracking no debe marcar el GenerationRun como FAILED.
    await this.trackNewRecipeImages(recipesForTracking);

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
      await this.failRun(run.id, userId, 'REJECTED', 'RESTRICTION_VIOLATION');
      throw error;
    }

    // Imágenes: las recetas que ya existían en el plan conservan la suya; sólo se buscan las nuevas.
    const { days: preparedDays, preservedImages } = this.prepareRecipeImages(dto.days, plan);
    const daysForPersistence = await this.resolveImagesOrDegrade(preparedDays);

    let recipesForTracking: RecipeForTracking[] = [];
    try {
      const persisted = await this.repository.updatePlanTransaction(userId, weekStart, daysForPersistence, run.id);
      recipesForTracking = persisted.recipesForTracking;
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

    // Registro de uso sólo para las imágenes nuevas, fuera del try/catch (igual que al crear).
    await this.trackNewRecipeImages(recipesForTracking.filter((item) => !preservedImages.has(item.image)));

    return this.getPlanByWeek(userId, dto.weekStart);
  }

  async getPlanByWeek(userId: string, weekStartStr: string) {
    const weekStart = this.parseDateString(weekStartStr);
    const plan = await this.repository.findPlanByWeek(userId, weekStart);

    if (!plan) throw new NotFoundException('Plan not found for this week');

    return {
      ...plan,
      days: (plan.days ?? []).map((day: any) => ({
        ...day,
        meals: (day.meals ?? []).map((meal: any) => {
          if (!meal.recipe) {
            return meal;
          }
          return {
            ...meal,
            recipe: {
              ...meal.recipe,
              // Se quita la metadata privada de tracking antes de devolver el plan.
              image: toPublicRecipeImage(meal.recipe.image as PersistedRecipeImage | null),
            },
          };
        }),
      })),
    };
  }

  // Si no se puede marcar el run, se prioriza devolver el error original (el TTL de PENDING lo libera después).
  private async failRun(runId: string, userId: string, status: 'FAILED' | 'REJECTED', errorCode: string) {
    try {
      await this.repository.transitionGenerationRun(runId, userId, ['PENDING'], status, { errorCode });
    } catch {
      this.logger.warn(`Could not mark GenerationRun ${runId} as ${status} (${errorCode})`);
    }
  }

  private validateRestrictions(days: MealPlanDayDto[], profile: NutritionProfile) {
    if (!days || days.length !== 7) {
      throw new BadRequestException(`Plan must have exactly 7 days`);
    }

    const forbidden = forbiddenRestrictions(profile);

    for (const day of days) {
      if (!day.meals || day.meals.length === 0) {
        throw new BadRequestException(`Empty meal list for day ${day.day}`);
      }

      for (const meal of day.meals) {
        // Mismo diccionario y mismos textos que el validador de NUT-74 (pasos incluidos).
        const restriction = findExcludedIngredient(restrictionTexts({
          mealTitle: meal.title,
          nutritionDescription: meal.nutritionalValues?.Description,
          title: meal.recipe?.title,
          description: meal.recipe?.description,
          ingredients: meal.recipe?.ingredients,
          instructions: meal.recipe?.instructions,
        }), forbidden);
        if (restriction) {
          throw new BadRequestException(`Meal '${meal.title}' contains excluded ingredient/concept: ${restriction}`);
        }
      }
    }
  }
}

// Recorre las comidas de los días en orden (los días o comidas mal formados se saltean; el
// envoltorio del plan los rechaza después). El índice coincide con el de flattenMeals.
function mapMeals(days: unknown[], fn: (meal: unknown, index: number) => unknown): unknown[] {
  let index = 0;
  return days.map(day => {
    if (typeof day !== 'object' || day === null || !Array.isArray((day as { meals?: unknown }).meals)) return day;
    return { ...day, meals: (day as { meals: unknown[] }).meals.map(meal => fn(meal, index++)) };
  });
}

function flattenMeals(days: unknown[]): unknown[] {
  const meals: unknown[] = [];
  for (const day of days) {
    const dayMeals = typeof day === 'object' && day !== null ? (day as { meals?: unknown }).meals : undefined;
    if (Array.isArray(dayMeals)) meals.push(...dayMeals);
  }
  return meals;
}

// Receta normalizada de un resultado válido o de un duplicado reutilizable.
function normalizedRecipeOf(result: ValidationResult): RecipeDraft | null {
  return result.valid ? result.normalizedRecipe : reusableDuplicate(result)?.normalizedRecipe ?? null;
}

// Los campos de receta que persiste el plan semanal (como antes de NUT-74), ya normalizados.
function recipeFields(recipe: RecipeDraft) {
  const { title, description, prepMinutes, cookMinutes, ingredients, instructions } = recipe;
  return { title, description, prepMinutes, cookMinutes, ingredients, instructions };
}
