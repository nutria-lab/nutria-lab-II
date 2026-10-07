import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NutritionProfile } from '../../generated/prisma/client';
import { parseJsonOutput } from '../recipe/validation/parse-generated-output';
import type { RecipeDraft, ValidationResult, ValidationSummary } from '../recipe/validation/recipe-validation.types';
import { reusableDuplicate, reusableRecipeId, summarizeParseFailure, summarizeResults } from '../recipe/validation/validate-recipe';
import { CreateMealPlanDto, MealDto, MealPlanDayDto } from './dto';
import { AiProviderUnavailableError, GEMINI_MODEL_NAME, GEMINI_PROVIDER, GeminiService } from './gemini/gemini.service';
import { PlansRepository } from './plans.repository';
import { RecipeValidationService, mealToDraftInput, type ValidatedRun } from './recipe-validation.service';

export interface WeeklyProposalInput {
  userId: string;
  runId: string;
  profile: NutritionProfile;
  weekStart: Date;
  weekStartStr: string;
}

export interface WeeklyProposal {
  // Plan listo para persistir: los duplicados del catálogo llevan reuseRecipeId en vez de receta.
  dto: CreateMealPlanDto;
  // Las mismas comidas con su receta normalizada (también las reutilizadas), para compararlas.
  comparableDays: MealPlanDayDto[];
  // Resumen de NUT-74 para el validationSnapshot del run.
  summary: ValidationSummary;
}

// Compone una propuesta semanal validada. NUT-76 puede reemplazar la implementación (por ejemplo,
// componer primero desde el catálogo) sin tocar la generación inicial ni la regeneración (NUT-78).
// Si el contenido es inválido, deja el run REJECTED y lanza 422; si el proveedor falla, FAILED y 503.
export abstract class WeeklyProposalComposer {
  abstract composeWeeklyProposal(input: WeeklyProposalInput): Promise<WeeklyProposal>;
}

// Implementación actual: la generación semanal con Gemini validada por NUT-74.
@Injectable()
export class GeminiWeeklyProposalComposer extends WeeklyProposalComposer {
  private readonly logger = new Logger(GeminiWeeklyProposalComposer.name);

  constructor(
    private readonly repository: PlansRepository,
    private readonly gemini: GeminiService,
    private readonly validation: RecipeValidationService,
  ) {
    super();
  }

  async composeWeeklyProposal({ userId, runId, profile, weekStart, weekStartStr }: WeeklyProposalInput): Promise<WeeklyProposal> {
    let raw: string;
    try {
      raw = await this.gemini.generateMealPlan(profile, weekStart);
    } catch (error) {
      // NUT-74: proveedor caído o timeout → 503; cualquier otro error es un bug y sigue de largo.
      if (error instanceof AiProviderUnavailableError) {
        await this.failRun(runId, userId, error.reason);
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
    const comparableDays = dto.days;

    // Duplicado exacto del catálogo: la comida apunta a esa receta (no se crea otra ni se busca su foto).
    dto.days = mapMeals(dto.days, (meal, index) => {
      const reuseRecipeId = reusableRecipeId(results[index]);
      if (!reuseRecipeId) return meal;
      const { recipe, ...mealWithoutRecipe } = meal as MealDto;
      return { ...mealWithoutRecipe, reuseRecipeId };
    }) as MealPlanDayDto[];

    return { dto, comparableDays, summary };
  }

  /**
   * NUT-74: el servidor valida cada comida generada; la IA nunca es la autoridad final. Si el
   * output no se puede leer o alguna comida es inválida, se rechaza el plan entero (no hay todavía
   * una forma de cubrir el hueco de una comida descartada): run REJECTED y 422, sin escribir
   * dominio. Un duplicado exacto del catálogo no es un rechazo: se reutiliza.
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
    // Una semana son 7 días: otra cantidad rechaza el lote entero (como en parseGeneratedOutput).
    if (days.length !== 7) {
      await this.validation.reject(run, summarizeParseFailure([
        { code: 'COUNT_MISMATCH', field: 'days', message: `Expected 7 days but the AI returned ${days.length}` },
      ]));
      throw new UnprocessableEntityException('The generated meal plan did not pass validation (COUNT_MISMATCH)');
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

  // Si no se puede marcar el run, se prioriza devolver el error original (el TTL de PENDING lo libera después).
  private async failRun(runId: string, userId: string, errorCode: string) {
    try {
      await this.repository.transitionGenerationRun(runId, userId, ['PENDING'], 'FAILED', { errorCode });
    } catch {
      this.logger.warn(`Could not mark GenerationRun ${runId} as FAILED (${errorCode})`);
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
