import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DayOfWeek, MealType, NutritionProfile } from '../../generated/prisma/client';
import { RecipeCoverageService } from '../recipe/recipe-coverage.service';
import type { RecipeCoverageCandidate } from '../recipe/recipe-coverage.types';
import { parseGeneratedOutput } from '../recipe/validation/parse-generated-output';
import type { RecipeDraft, ValidationResult, ValidationSummary } from '../recipe/validation/recipe-validation.types';
import {
  reusableDuplicate,
  summarizeParseFailure,
  summarizeResults,
} from '../recipe/validation/validate-recipe';
import {
  RECIPE_GENERATION_PROMPT_VERSION,
  RECIPE_GENERATION_PROVIDER,
  RECIPE_GENERATION_SCHEMA_VERSION,
  type RecipeGenerationProvider,
} from '../recipe-generation/recipe-generation.ports';
import { AiProviderUnavailableError, OPENAI_MODEL_NAME, OPENAI_PROVIDER } from '../openai/openai.service';
import { RecipeValidationService, type ValidatedRun } from './recipe-validation.service';
import { mapRecipeNutritionToMeal } from './recipe-nutrition.mapper';
import { CreateMealPlanDto, MealPlanDayDto } from './dto';
import { PlansRepository } from './plans.repository';
import {
  buildWeeklySlots,
  chunkHomogeneous,
  matchRecipesToSlots,
  type WeeklyMealSlot,
} from './weekly-proposal-assignment';

export interface WeeklyProposalInput {
  userId: string;
  runId: string;
  profile: NutritionProfile;
  weekStart: Date;
  weekStartStr: string;
  onModelSelected?: (model: string) => void;
}

export interface WeeklyCompositionSnapshot extends Record<string, unknown> {
  compositionVersion: 'weekly-catalog-composition-v1';
  aiInvoked: boolean;
  batches: Array<{
    mealType: MealType;
    count: number;
    model: string;
    promptVersion: string;
    schemaVersion: string;
  }>;
}

export interface WeeklyProposal {
  dto: CreateMealPlanDto;
  comparableDays: MealPlanDayDto[];
  summary: ValidationSummary;
  compositionSnapshot?: WeeklyCompositionSnapshot;
}

export type WeeklyRecipeEligibilityPolicy = (
  candidate: RecipeCoverageCandidate | Record<string, unknown>,
  slot: WeeklyMealSlot,
) => boolean;

export const WEEKLY_RECIPE_ELIGIBILITY_POLICY = Symbol('WEEKLY_RECIPE_ELIGIBILITY_POLICY');
export const WEEKLY_COMPOSITION_VERSION = 'weekly-catalog-composition-v1' as const;
const GENERATION_MEAL_ORDER = [MealType.BREAKFAST, MealType.LUNCH, MealType.SNACK, MealType.DINNER];

// Sin una fuente aprobada para clasificar Recipes por mealType, el catálogo falla cerrado.
export const noClassifiedWeeklyRecipe: WeeklyRecipeEligibilityPolicy = () => false;

export abstract class WeeklyProposalComposer {
  abstract composeWeeklyProposal(input: WeeklyProposalInput): Promise<WeeklyProposal>;
}

@Injectable()
export class OpenAIWeeklyProposalComposer extends WeeklyProposalComposer {
  private readonly logger = new Logger(OpenAIWeeklyProposalComposer.name);

  constructor(
    private readonly repository: PlansRepository,
    @Inject(RecipeCoverageService) private readonly coverage: Pick<RecipeCoverageService, 'evaluate'>,
    @Inject(RECIPE_GENERATION_PROVIDER) private readonly provider: RecipeGenerationProvider,
    private readonly validation: RecipeValidationService,
    @Optional() @Inject(WEEKLY_RECIPE_ELIGIBILITY_POLICY)
    private readonly eligibilityPolicy: WeeklyRecipeEligibilityPolicy = noClassifiedWeeklyRecipe,
  ) {
    super();
  }

  async composeWeeklyProposal(input: WeeklyProposalInput): Promise<WeeklyProposal> {
    const slots = buildWeeklySlots(input.weekStart);
    const candidates = await this.loadCatalogCandidates(input.userId, slots, input.runId);
    const assignedCatalog = matchRecipesToSlots(
      slots,
      candidates,
      (slot, candidate) => this.isEligible(slot as WeeklyMealSlot, candidate),
    );
    const usedRecipeIds = new Set([...assignedCatalog.values()].map(recipe => recipe.id));
    const missingSlots = slots.filter(slot => !assignedCatalog.has(slot.key));
    const generated = await this.generateDeficit(input, [...missingSlots].sort((left, right) =>
      GENERATION_MEAL_ORDER.indexOf(left.mealType) - GENERATION_MEAL_ORDER.indexOf(right.mealType),
    ));
    const summary = generated.validationResults.length > 0
      ? summarizeResults(generated.validationResults)
      : { stage: 'passed' as const, codes: [], warnings: [] };

    const newRecipeBySlot = new Map<string, RecipeDraft>();
    for (const [index, result] of generated.validationResults.entries()) {
      const slot = generated.slotOrder[index];
      if (!result.valid) {
        const reusable = reusableDuplicate(result);
        if (!reusable) {
          const rejection = summarizeResults(generated.validationResults.filter(candidate => !candidate.valid && !reusableDuplicate(candidate)));
          await this.validation.reject(this.run(input), rejection);
          throw new UnprocessableEntityException(`The generated meal plan did not pass validation (${rejection.codes[0]})`);
        }

        const reusableRecipe = await this.findReusableCandidate(reusable.recipeId, candidates);
        if (!reusableRecipe || usedRecipeIds.has(reusableRecipe.id) || !this.isEligible(slot, reusableRecipe)) {
          await this.validation.reject(this.run(input), {
            stage: 'duplicates',
            codes: ['DUPLICATE_RECIPE'],
            warnings: [],
          });
          throw new UnprocessableEntityException('The generated meal plan did not pass validation (DUPLICATE_RECIPE)');
        }
        try {
          mapRecipeNutritionToMeal(reusableRecipe);
        } catch {
          await this.rejectMissingMealNutrition(input);
        }
        usedRecipeIds.add(reusableRecipe.id);
        assignedCatalog.set(slot.key, reusableRecipe);
        continue;
      }

      try {
        mapRecipeNutritionToMeal(result.normalizedRecipe);
      } catch {
        await this.rejectMissingMealNutrition(input);
      }
      newRecipeBySlot.set(slot.key, result.normalizedRecipe);
    }

    const days = this.buildDays(slots, assignedCatalog, newRecipeBySlot);
    const dto = plainToInstance(CreateMealPlanDto, {
      weekStart: input.weekStartStr,
      days,
    });
    const errors = await validate(dto);
    if (errors.length > 0) {
      await this.validation.rejectWithCode(this.run(input), 'AI_INVALID_SCHEMA');
      throw new UnprocessableEntityException('The generated meal plan did not pass validation (AI_INVALID_SCHEMA)');
    }

    const comparableDays = dto.days;
    dto.days = dto.days.map(day => ({
      ...day,
      meals: day.meals.map((meal: any) => {
        const existing = assignedCatalog.has(`${day.date}:${meal.mealType}`);
        if (!existing) return meal;
        const { recipe: _recipe, ...withoutRecipe } = meal;
        return { ...withoutRecipe, reuseRecipeId: assignedCatalog.get(`${day.date}:${meal.mealType}`)!.id };
      }),
    })) as MealPlanDayDto[];

    return {
      dto,
      comparableDays,
      summary,
      compositionSnapshot: {
        compositionVersion: WEEKLY_COMPOSITION_VERSION,
        aiInvoked: generated.batches.length > 0,
        batches: generated.batches,
      },
    };
  }

  private async loadCatalogCandidates(userId: string, slots: WeeklyMealSlot[], runId: string): Promise<RecipeCoverageCandidate[]> {
    const candidates = new Map<string, RecipeCoverageCandidate>();
    const seenIds = new Set<string>();

    try {
      while (candidates.size < slots.length) {
        const page = await this.coverage.evaluate({
          userId,
          desiredTotal: 10,
          excludeRecipeIds: [...seenIds],
        });
        const returned = page.result.compatibleRecipes.map(item => item.recipe as RecipeCoverageCandidate);
        let newIds = 0;
        for (const candidate of returned) {
          if (!seenIds.has(candidate.id)) {
            newIds++;
            seenIds.add(candidate.id);
            if (this.canMatchAnySlot(slots, candidate)) candidates.set(candidate.id, candidate);
          }
        }
        if (candidates.size >= slots.length || returned.length < 10 || newIds === 0) break;
      }
    } catch (error) {
      await this.failRun(runId, userId, 'RECIPE_COVERAGE_UNAVAILABLE');
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Recipe catalog is temporarily unavailable');
    }

    return [...candidates.values()];
  }

  private canMatchAnySlot(slots: WeeklyMealSlot[], candidate: RecipeCoverageCandidate): boolean {
    return slots.some(slot => this.isEligible(slot, candidate));
  }

  private isEligible(slot: WeeklyMealSlot, candidate: RecipeCoverageCandidate | Record<string, unknown>): boolean {
    try {
      mapRecipeNutritionToMeal(candidate);
    } catch {
      return false;
    }
    return this.eligibilityPolicy(candidate, slot);
  }

  private async generateDeficit(input: WeeklyProposalInput, missingSlots: WeeklyMealSlot[]) {
    const slotOrder: WeeklyMealSlot[] = [];
    const drafts: unknown[] = [];
    const batches: WeeklyCompositionSnapshot['batches'] = [];

    for (const batch of chunkHomogeneous(missingSlots, slot => slot.mealType, 10)) {
      const mealType = batch[0].mealType;
      let selectedModel: string = OPENAI_MODEL_NAME;
      let raw: string;
      try {
        raw = await this.provider.generate({
          profile: input.profile,
          criteria: { mealType },
          count: batch.length,
          promptVersion: RECIPE_GENERATION_PROMPT_VERSION,
          schemaVersion: RECIPE_GENERATION_SCHEMA_VERSION,
        }, async model => {
          selectedModel = model;
          if (model !== OPENAI_MODEL_NAME && typeof (this.repository as any).updatePendingGenerationRunModel === 'function') {
            const updated = await this.repository.updatePendingGenerationRunModel(input.runId, input.userId, model);
            if (updated === 0) throw new Error(`GenerationRun ${input.runId} is no longer pending`);
          }
          input.onModelSelected?.(model);
        });
      } catch (error) {
        if (error instanceof AiProviderUnavailableError) {
          await this.failRun(input.runId, input.userId, error.reason);
          throw new ServiceUnavailableException('The AI provider is not available; retry later');
        }
        throw error;
      }

      const parsed = parseGeneratedOutput(raw, batch.length);
      const run = this.run(input, selectedModel);
      if (!parsed.ok) {
        await this.validation.reject(run, summarizeParseFailure(parsed.errors));
        throw new UnprocessableEntityException(`The generated meal plan did not pass validation (${parsed.errors[0].code})`);
      }

      batches.push({
        mealType,
        count: batch.length,
        model: selectedModel,
        promptVersion: RECIPE_GENERATION_PROMPT_VERSION,
        schemaVersion: RECIPE_GENERATION_SCHEMA_VERSION,
      });
      slotOrder.push(...batch);
      drafts.push(...parsed.value);
    }

    const validationResults = drafts.length > 0
      ? await this.validation.validateDrafts(drafts, undefined, { detectBatchDuplicates: true })
      : [];

    return { slotOrder, validationResults, batches };
  }

  private async findReusableCandidate(id: string, candidates: RecipeCoverageCandidate[]) {
    const discovered = candidates.find(candidate => candidate.id === id);
    if (discovered) return discovered;
    return this.validation.findRecipeById(id) as Promise<RecipeCoverageCandidate | null>;
  }

  private buildDays(
    slots: WeeklyMealSlot[],
    assignedCatalog: Map<string, RecipeCoverageCandidate>,
    newRecipeBySlot: Map<string, RecipeDraft>,
  ) {
    const days = new Map<string, { day: DayOfWeek; date: string; meals: any[] }>();
    for (const slot of slots) {
      const recipe = assignedCatalog.get(slot.key) ?? newRecipeBySlot.get(slot.key);
      if (!recipe) {
        throw new UnprocessableEntityException('The generated meal plan did not pass validation (COUNT_MISMATCH)');
      }
      const nutritionalValues = mapRecipeNutritionToMeal(recipe);
      const day = days.get(slot.date) ?? { day: slot.day, date: slot.date, meals: [] };
      day.meals.push({
        mealType: slot.mealType,
        title: recipe.title,
        nutritionalValues,
        recipe: {
          title: recipe.title,
          description: recipe.description,
          prepMinutes: recipe.prepMinutes,
          cookMinutes: recipe.cookMinutes,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
          categories: recipe.categories,
          properties: recipe.properties,
          nutritionalValues: recipe.nutritionalValues,
          ...( 'image' in recipe ? { image: recipe.image } : {}),
        },
      });
      days.set(slot.date, day);
    }
    return [...days.values()];
  }

  private run(input: WeeklyProposalInput, model: string = OPENAI_MODEL_NAME): ValidatedRun {
    return { id: input.runId, userId: input.userId, provider: OPENAI_PROVIDER, model };
  }

  private async rejectMissingMealNutrition(input: WeeklyProposalInput): Promise<never> {
    await this.validation.reject(this.run(input), { stage: 'schema', codes: ['MISSING_FIELD'], warnings: [] });
    throw new UnprocessableEntityException('The generated meal plan did not pass validation (MISSING_FIELD)');
  }

  private async failRun(runId: string, userId: string, errorCode: string) {
    try {
      await this.repository.transitionGenerationRun(runId, userId, ['PENDING'], 'FAILED', { errorCode });
    } catch {
      this.logger.warn(`Could not mark GenerationRun ${runId} as FAILED (${errorCode})`);
    }
  }
}
