import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
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
import { buildProfileSnapshot } from './generation-run-snapshot';
import { findRestrictionViolation, forbiddenRestrictions } from './meal-restrictions.util';
import { MealReplacementConflictError, PlansRepository } from './plans.repository';

const KIND = 'MEAL_REPLACEMENT';
// Cuántas recetas del catálogo pedir a NUT-72: si la mejor no pasa las restricciones, se prueba la siguiente.
const COVERAGE_CANDIDATES = 5;
const DEFAULT_PENDING_TTL_MINUTES = 10;

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
  plannedMeal: { id: string; mealType: MealType; title: string; recipeId: string; recipe: Recipe };
  generationRunId: string;
}

// Reemplaza UNA comida del plan actual sin tocar el resto de la semana (NUT-77).
// Orden: dueño/plan → idempotencia → catálogo (NUT-72) → si no hay, IA (una sola) → transacción corta.
@Injectable()
export class MealReplacementService {
  constructor(
    private readonly repository: PlansRepository,
    private readonly gemini: GeminiService,
    private readonly coverage: RecipeCoverageService,
    private readonly config: ConfigService,
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
    if (!wasCreated && this.isStalePending(run)) {
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
      : await this.generateRecipe(userId, runId, profile, meal.mealType, criteria, forbidden);

    // 4. Guardar, sólo la comida objetivo, en una transacción corta.
    try {
      const { recipe, plannedMeal } = await this.repository.replaceMealTransaction({
        userId,
        planId: plan.id,
        expectedPlanUpdatedAt: plan.updatedAt,
        plannedMealId: meal.id,
        generationRunId: runId,
        ...write,
      });
      return this.buildResponse(plan, dayId, plannedMeal, recipe, runId);
    } catch (error) {
      // La transacción se revirtió entera: se marca el run con el motivo concreto.
      const conflict = error instanceof MealReplacementConflictError;
      await this.failRun(runId, userId, 'FAILED', conflict ? 'CONCURRENT_CONFLICT' : 'PERSISTENCE_FAILED');
      if (conflict) throw new ConflictException('The meal plan changed during the replacement; retry');
      throw error;
    }
  }

  // PENDING más viejo que MEAL_REPLACEMENT_PENDING_TTL_MINUTES (por defecto 10): el intento se colgó.
  private isStalePending(run: { status: string; startedAt?: Date | string; createdAt?: Date | string }): boolean {
    if (run.status !== 'PENDING') return false;
    const configured = Number(this.config.get<string>('MEAL_REPLACEMENT_PENDING_TTL_MINUTES'));
    const ttlMinutes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PENDING_TTL_MINUTES;
    const startedAt = new Date(run.startedAt ?? run.createdAt ?? Date.now()).getTime();
    return Date.now() - startedAt > ttlMinutes * 60_000;
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
      // Defensa extra: la receta también tiene que pasar la misma validación de restricciones que la IA.
      const safe = found.find(recipe => !findRestrictionViolation(
        { title: recipe.title, nutritionalValues: { Description: recipe.description }, recipe: recipe as any },
        forbidden,
      ));
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

  // NUT-73/74: genera exactamente una comida y la valida antes de guardarla.
  private async generateRecipe(
    userId: string,
    runId: string,
    profile: NutritionProfile,
    mealType: MealType,
    criteria: ReplacementCriteria,
    forbidden: string[],
  ) {
    let generated: unknown;
    try {
      generated = await this.gemini.generateReplacementMeal(profile, mealType, criteria);
    } catch (error) {
      if (error instanceof AiProviderUnavailableError) {
        await this.failRun(runId, userId, 'FAILED', error.reason);
        throw new ServiceUnavailableException('The AI provider is not available; retry later');
      }
      throw error;
    }

    const meal = plainToInstance(MealDto, { ...(generated as object), mealType });
    if (!generated || (await validate(meal)).length > 0) {
      await this.failRun(runId, userId, 'REJECTED', 'AI_INVALID_SCHEMA');
      throw new UnprocessableEntityException('No compatible replacement was found');
    }
    if (findRestrictionViolation(meal, forbidden)) {
      await this.failRun(runId, userId, 'REJECTED', 'RESTRICTION_VIOLATION');
      throw new UnprocessableEntityException('No compatible replacement was found');
    }
    const tags = this.recipeTags(generated);
    if (!this.meetsCriteria(meal.recipe.prepMinutes, tags, criteria)) {
      await this.failRun(runId, userId, 'REJECTED', 'CRITERIA_NOT_MET');
      throw new UnprocessableEntityException('No compatible replacement was found');
    }

    const { recipe } = meal;
    return {
      newRecipe: {
        title: recipe.title,
        description: recipe.description,
        prepMinutes: recipe.prepMinutes,
        cookMinutes: recipe.cookMinutes,
        ingredients: recipe.ingredients as any,
        instructions: recipe.instructions,
        categories: tags.categories,
        properties: tags.properties,
      },
      title: meal.title,
      nutritionalValues: { ...meal.nutritionalValues },
      outputSnapshot: { path: 'AI_GENERATED' },
      validationSnapshot: { source: 'ai', restrictionsChecked: true },
    };
  }

  // Categorías (sólo valores válidos) y propiedades (normalizadas) con las que Gemini clasificó la receta.
  private recipeTags(generated: unknown): { categories: RecipeCategory[]; properties: string[] } {
    const recipe = (generated as { recipe?: { categories?: unknown; properties?: unknown } }).recipe ?? {};
    const valid = new Set<string>(Object.values(RecipeCategory));
    const categories = Array.isArray(recipe.categories) ? recipe.categories.filter(value => valid.has(value)) : [];
    const properties = Array.isArray(recipe.properties) ? recipe.properties.filter(value => typeof value === 'string') : [];
    return { categories: [...new Set(categories)] as RecipeCategory[], properties: normalizeProperties(properties) };
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

  private buildResponse(plan: any, dayId: string, plannedMeal: any, recipe: Recipe, generationRunId: string) {
    return {
      planId: plan.id,
      version: plan.version,
      dayId,
      plannedMeal: {
        id: plannedMeal.id,
        mealType: plannedMeal.mealType,
        title: plannedMeal.title,
        recipeId: recipe.id,
        recipe,
      },
      generationRunId,
    };
  }
}
