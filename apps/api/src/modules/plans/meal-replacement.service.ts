import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MealType, NutritionProfile, Recipe, RecipeCategory } from '../../generated/prisma/client';
import { RecipeCoverageService } from '../recipe/recipe-coverage.service';
import { InsufficientCoverageProfileError } from '../recipe/recipe-coverage.types';
import { canonicalJson, computeIdempotencyKeyHash } from '../../utils/idempotency-hash.util';
import { normalizeProperties } from '../../utils/normalize-properties.util';
import { MealDto, ReplaceMealDto } from './dto';
import { AiProviderUnavailableError, GeminiService, GEMINI_MODEL_NAME, GEMINI_PROVIDER } from './gemini/gemini.service';
import { REPLACEMENT_PROMPT_VERSION } from './gemini/prompts';
import { parseJsonOutput } from '../recipe/validation/parse-generated-output';
import { buildProfileSnapshot } from './generation-run-snapshot';
import { findExcludedIngredient, forbiddenRestrictions, restrictionTexts } from '../recipe/validation/ingredient-dictionary';
import { reusableDuplicate, summarizeParseFailure, summarizeResults } from '../recipe/validation/validate-recipe';
import { isStalePendingRun } from './generation-run-ttl';
import { RecipeValidationService, mealToDraftInput } from './recipe-validation.service';
import { MealReplacementConflictError, PlansRepository } from './plans.repository';
import { UnsplashService, toPublicRecipeImage } from '@/modules/unsplash/unsplash.service';
import type { PersistedRecipeImage, RecipeImage } from '@/modules/unsplash/recipe-image.types';

const KIND = 'MEAL_REPLACEMENT';
// Cuántas recetas del catálogo pedir a NUT-72: si la mejor no pasa las restricciones, se prueba la siguiente.
const COVERAGE_CANDIDATES = 5;

type ReplacementCriteria = {
  topic?: string;
  categories: RecipeCategory[];
  properties: string[];
  maxPrepMinutes?: number;
};

export interface MealReplacementResponse {
  planId: string;
  version: number;
  dayId: string;
  plannedMeal: {
    id: string;
    mealType: MealType;
    title: string;
    recipeId: string;
    recipe: Omit<Recipe, 'image'> & { image: RecipeImage | null };
  };
  generationRunId: string;
}

// Reemplaza UNA comida del plan actual sin tocar el resto de la semana (NUT-77).
// Orden: dueño/plan → idempotencia → catálogo (NUT-72) → si no hay, IA (una sola) → transacción corta.
@Injectable()
export class MealReplacementService {
  private readonly logger = new Logger(MealReplacementService.name);

  constructor(
    private readonly repository: PlansRepository,
    private readonly gemini: GeminiService,
    private readonly coverage: RecipeCoverageService,
    private readonly config: ConfigService,
    private readonly unsplash: UnsplashService,
    private readonly validation: RecipeValidationService,
  ) {}

  async replaceMeal(
    userId: string,
    planId: string,
    plannedMealId: string,
    idempotencyKey: string,
    dto: ReplaceMealDto,
  ): Promise<MealReplacementResponse> {
    // 1. El plan existe (404), es del usuario (403), contiene la comida (404) y es el actual (409).
    const plan = await this.repository.findPlanWithMeals(planId);
    if (!plan) throw new NotFoundException('Meal plan not found');
    if (plan.userId !== userId) throw new ForbiddenException('This meal plan belongs to another user');

    const day = plan.days.find(candidate => candidate.meals.some(meal => meal.id === plannedMealId));
    const meal = day?.meals.find(candidate => candidate.id === plannedMealId);
    if (!day || !meal) throw new NotFoundException('Planned meal not found in this plan');
    if (!plan.isCurrent) throw new ConflictException('Only the current version of the plan can be changed');

    const user = await this.repository.getUserWithProfile(userId);
    if (!user?.nutritionProfile) throw new BadRequestException('User needs a nutrition profile');
    const profile = user.nutritionProfile;

    // 2. Idempotencia: la misma Idempotency-Key siempre cae en el mismo GenerationRun.
    const criteria = this.normalizeCriteria(dto);
    const requestSnapshot = {
      kind: KIND,
      planId,
      plannedMealId,
      criteria,
      promptVersion: REPLACEMENT_PROMPT_VERSION.version,
      schemaVersion: REPLACEMENT_PROMPT_VERSION.schemaVersion,
    };
    const idempotencyKeyHash = computeIdempotencyKeyHash({ userId, kind: KIND, requestSnapshot: { idempotencyKey } });

    const createOrRecoverRun = () => this.repository.createOrRecoverGenerationRun(
      userId,
      KIND,
      GEMINI_PROVIDER,
      GEMINI_MODEL_NAME,
      REPLACEMENT_PROMPT_VERSION.version,
      REPLACEMENT_PROMPT_VERSION.schemaVersion,
      requestSnapshot,
      buildProfileSnapshot(profile),
      idempotencyKeyHash,
    );
    let { run, wasCreated } = await createOrRecoverRun();

    // Un intento anterior quedó colgado: se lo marca EXPIRED, lo que libera la clave, y se sigue de cero.
    if (!wasCreated && isStalePendingRun(run, this.config)) {
      await this.repository.transitionGenerationRun(run.id, userId, ['PENDING'], 'EXPIRED', { errorCode: 'PENDING_TIMEOUT' });
      ({ run, wasCreated } = await createOrRecoverRun());
    }

    if (!wasCreated) {
      return this.replayExistingRun(run, requestSnapshot, plan, day.id, meal);
    }

    // Desde acá, cualquier error deja el run terminado (nunca PENDING para siempre).
    try {
      return await this.runReplacement(userId, run.id, plan, day.id, meal, profile, criteria);
    } catch (error) {
      await this.failRun(run.id, userId, 'FAILED', 'UNEXPECTED_ERROR');
      throw error;
    }
  }

  private async runReplacement(
    userId: string,
    runId: string,
    plan: any,
    dayId: string,
    meal: any,
    profile: NutritionProfile,
    criteria: ReplacementCriteria,
  ): Promise<MealReplacementResponse> {
    // 3. Primero el catálogo (sin IA); si no hay ninguna compatible, se genera una.
    const forbidden = forbiddenRestrictions(profile);
    const existing = await this.findCatalogRecipe(userId, plan, meal.recipeId, criteria, forbidden);

    const write = existing
      ? {
          existingRecipeId: existing.id,
          nutritionalValues: this.nutritionalValuesFromRecipe(existing),
          outputSnapshot: { path: 'REUSED_EXISTING_RECIPE' },
          validationSnapshot: { source: 'coverage', restrictionsChecked: true },
        }
      : await this.generateRecipe(userId, runId, profile, meal.mealType, criteria, meal.recipeId ?? null);

    // 4. Guardar, sólo la comida objetivo, en una transacción corta.
    let saved: { recipe: any; plannedMeal: any };
    try {
      saved = await this.repository.replaceMealTransaction({
        userId,
        planId: plan.id,
        expectedPlanUpdatedAt: plan.updatedAt,
        plannedMealId: meal.id,
        generationRunId: runId,
        ...write,
      });
    } catch (error) {
      // La transacción se revirtió entera: se marca el run con el motivo concreto.
      const conflict = error instanceof MealReplacementConflictError;
      await this.failRun(runId, userId, 'FAILED', conflict ? 'CONCURRENT_CONFLICT' : 'PERSISTENCE_FAILED');
      if (conflict) throw new ConflictException('The meal plan changed during the replacement; retry');
      throw error;
    }

    // 5. Foto nueva de la IA: el uso se registra en Unsplash recién ahora, con la receta ya guardada (NUT-83).
    const recipe = 'newRecipe' in write && write.newRecipe.image ? await this.trackNewRecipeImage(saved.recipe) : saved.recipe;
    return this.buildResponse(plan, dayId, saved.plannedMeal, recipe, runId);
  }

  // NUT-83: busca la foto de una receta nueva. Si falla, la receta se guarda igual sin imagen.
  private async findImage(title: string): Promise<PersistedRecipeImage | null> {
    try {
      return await this.unsplash.searchAndSelectCandidate(title);
    } catch {
      return null;
    }
  }

  // NUT-83: registra el uso de la foto y guarda el resultado. Si guardarlo falla, queda PENDING
  // para el script de recuperación; el reemplazo ya está hecho y se responde igual.
  private async trackNewRecipeImage(recipe: any) {
    const tracked = await this.unsplash.trackDownload(recipe.image as PersistedRecipeImage);
    try {
      await this.repository.updateRecipeImageTracking(recipe.id, tracked as any);
      return { ...recipe, image: tracked };
    } catch {
      this.logger.warn(`Could not save Unsplash tracking status for recipeId=${recipe.id}; it stays PENDING for recovery`);
      return recipe;
    }
  }

  // Ordenados, sin duplicados y (propiedades) en minúsculas: el mismo pedido escrito distinto da la misma huella.
  private normalizeCriteria(dto: ReplaceMealDto): ReplacementCriteria {
    const topic = dto.topic?.trim();
    return {
      ...(topic ? { topic } : {}),
      categories: [...new Set(dto.categories ?? [])].sort(),
      properties: normalizeProperties(dto.properties ?? []).map(property => property.toLowerCase()).sort(),
      ...(dto.maxPrepMinutes !== undefined ? { maxPrepMinutes: dto.maxPrepMinutes } : {}),
    };
  }

  // Misma clave ya usada: mismo pedido y terminado → mismo resultado; pedido distinto o en curso → 409.
  private async replayExistingRun(run: any, requestSnapshot: unknown, plan: any, dayId: string, meal: any) {
    if (canonicalJson(run.requestSnapshot) !== canonicalJson(requestSnapshot)) {
      throw new ConflictException('This Idempotency-Key was already used for a different request');
    }
    if (run.status !== 'SUCCEEDED') {
      throw new ConflictException('A replacement with this Idempotency-Key is already in progress');
    }

    const recipe = await this.repository.findRecipeById(run.outputSnapshot?.recipeId);
    if (!recipe) throw new ConflictException('The replacement for this Idempotency-Key is no longer available');
    const title = run.outputSnapshot?.title ?? recipe.title;
    return this.buildResponse(plan, dayId, { ...meal, title }, recipe, run.id);
  }

  // NUT-72: busca en el catálogo excluyendo la receta actual y, si se puede, las ya usadas esa semana.
  private async findCatalogRecipe(
    userId: string,
    plan: any,
    currentRecipeId: string | null,
    criteria: ReplacementCriteria,
    forbidden: string[],
  ): Promise<Recipe | null> {
    const usedThisWeek: string[] = plan.days.flatMap((day: any) => day.meals.map((meal: any) => meal.recipeId)).filter(Boolean);
    const exclusions = [[...new Set(usedThisWeek)], currentRecipeId ? [currentRecipeId] : []];

    for (const excludeRecipeIds of exclusions) {
      const found = await this.compatibleCatalogRecipes(userId, criteria, excludeRecipeIds);
      // Defensa extra: la receta también tiene que pasar el mismo diccionario de restricciones que la IA (NUT-74).
      const safe = found.find(recipe => !findExcludedIngredient(restrictionTexts(recipe), forbidden));
      if (safe) return safe;
    }
    return null;
  }

  private async compatibleCatalogRecipes(userId: string, criteria: ReplacementCriteria, excludeRecipeIds: string[]) {
    try {
      const { result } = await this.coverage.evaluate({ userId, ...criteria, excludeRecipeIds, desiredTotal: COVERAGE_CANDIDATES });
      return result.compatibleRecipes.map(candidate => candidate.recipe);
    } catch (error) {
      // NUT-72 no sabe traducir algunos perfiles (ej. KETO o NUTS): se sigue con la IA.
      if (error instanceof InsufficientCoverageProfileError) return [];
      throw error;
    }
  }

  // NUT-73/74: genera exactamente una comida y el servidor la valida antes de guardarla (la IA
  // nunca juzga su propio output). Inválida → REJECTED y 422, sin escribir nada. Un duplicado
  // exacto del catálogo no es un rechazo: se reutiliza esa receta.
  private async generateRecipe(
    userId: string,
    runId: string,
    profile: NutritionProfile,
    mealType: MealType,
    criteria: ReplacementCriteria,
    currentRecipeId: string | null,
  ) {
    let raw: string;
    try {
      raw = await this.gemini.generateReplacementMeal(profile, mealType, criteria);
    } catch (error) {
      if (error instanceof AiProviderUnavailableError) {
        await this.failRun(runId, userId, 'FAILED', error.reason);
        throw new ServiceUnavailableException('The AI provider is not available; retry later');
      }
      throw error;
    }

    const run = { id: runId, userId, provider: GEMINI_PROVIDER, model: GEMINI_MODEL_NAME };
    const parsed = parseJsonOutput(raw);
    if (!parsed.ok) {
      await this.validation.reject(run, summarizeParseFailure(parsed.errors));
      throw new UnprocessableEntityException('No compatible replacement was found');
    }

    const [result] = await this.validation.validateDrafts([mealToDraftInput(parsed.value)], profile);
    const duplicate = reusableDuplicate(result);
    if (!result.valid && !duplicate) {
      await this.validation.reject(run, summarizeResults([result]));
      throw new UnprocessableEntityException('No compatible replacement was found');
    }
    // Receta ya normalizada: la del resultado válido o la del duplicado que se va a reutilizar.
    const recipe = result.valid ? result.normalizedRecipe : duplicate!.normalizedRecipe;

    // Envoltorio de la comida (título y macros) con la receta ya normalizada.
    const meal = plainToInstance(MealDto, { ...(parsed.value as Record<string, unknown>), mealType, recipe });
    if ((await validate(meal)).length > 0) {
      await this.validation.rejectWithCode(run, 'AI_INVALID_SCHEMA');
      throw new UnprocessableEntityException('No compatible replacement was found');
    }

    const mealFields = {
      title: meal.title,
      nutritionalValues: { ...meal.nutritionalValues },
      validationSnapshot: { ...summarizeResults([result]) },
    };
    if (duplicate) {
      // Reutilizar la receta que la comida ya tiene no es un reemplazo.
      const existing = duplicate.recipeId === currentRecipeId ? null : await this.repository.findRecipeById(duplicate.recipeId);
      if (!existing || !this.meetsCriteria(existing.prepMinutes, existing, criteria)) {
        await this.validation.rejectWithCode(run, 'CRITERIA_NOT_MET');
        throw new UnprocessableEntityException('No compatible replacement was found');
      }
      return { ...mealFields, existingRecipeId: duplicate.recipeId, outputSnapshot: { path: 'REUSED_DUPLICATE_RECIPE' } };
    }

    if (!this.meetsCriteria(recipe.prepMinutes, recipe, criteria)) {
      await this.validation.rejectWithCode(run, 'CRITERIA_NOT_MET');
      throw new UnprocessableEntityException('No compatible replacement was found');
    }

    const image = await this.findImage(recipe.title);
    return {
      ...mealFields,
      newRecipe: {
        ...(image ? { image } : {}),
        title: recipe.title,
        description: recipe.description,
        prepMinutes: recipe.prepMinutes,
        cookMinutes: recipe.cookMinutes,
        ingredients: recipe.ingredients as any,
        instructions: recipe.instructions,
        categories: recipe.categories,
        properties: recipe.properties,
      },
      outputSnapshot: { path: 'AI_GENERATED' },
    };
  }

  // Misma regla que NUT-72: tiempo máximo, al menos una categoría pedida y todas las propiedades pedidas.
  private meetsCriteria(prepMinutes: number, tags: { categories: RecipeCategory[]; properties: string[] }, criteria: ReplacementCriteria) {
    const recipeProperties = new Set(tags.properties.map(property => property.toLowerCase()));
    return (criteria.maxPrepMinutes === undefined || prepMinutes <= criteria.maxPrepMinutes) &&
      (criteria.categories.length === 0 || criteria.categories.some(category => tags.categories.includes(category))) &&
      criteria.properties.every(property => recipeProperties.has(property.toLowerCase()));
  }

  // Las recetas del catálogo guardan macros como { calories, protein, fiber }; la comida usa otra forma.
  private nutritionalValuesFromRecipe(recipe: Recipe) {
    const values = (recipe.nutritionalValues ?? {}) as Record<string, unknown>;
    const number = (value: unknown) => (typeof value === 'number' ? value : 0);
    return {
      Protein: number(values.protein),
      Fiber: number(values.fiber),
      Calories: number(values.calories),
      Description: recipe.description,
    };
  }

  private async failRun(runId: string, userId: string, status: 'FAILED' | 'REJECTED', errorCode: string) {
    try {
      await this.repository.transitionGenerationRun(runId, userId, ['PENDING'], status, { errorCode });
    } catch {
      // Si no se puede marcar el run, se prioriza devolver el error original al cliente.
    }
  }

  // La imagen pasa por toPublicRecipeImage: la metadata privada de tracking nunca sale (NUT-83).
  private buildResponse(plan: any, dayId: string, plannedMeal: any, recipe: Recipe, generationRunId: string) {
    const image = toPublicRecipeImage(((recipe as { image?: unknown }).image ?? null) as PersistedRecipeImage | null);
    return {
      planId: plan.id,
      version: plan.version,
      dayId,
      plannedMeal: {
        id: plannedMeal.id,
        mealType: plannedMeal.mealType,
        title: plannedMeal.title,
        recipeId: recipe.id,
        recipe: { ...recipe, image },
      },
      generationRunId,
    };
  }
}
