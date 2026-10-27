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
import { DayOfWeek, MealType, NutritionProfile, Recipe } from '../../generated/prisma/client';
import { RecipeCoverageService } from '../recipe/recipe-coverage.service';
import type { RecipeCoverageCandidate } from '../recipe/recipe-coverage.types';
import { RecipeRepository } from '../recipe/recipe.repository';
import { recipeFingerprint } from '../recipe/recipe-fingerprint.util';
import {
  findExcludedIngredientInSource,
  hasSupportedProfilePolicy,
  profileForbiddenRestrictions,
} from '../recipe/validation/ingredient-dictionary';
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
import {
  MEALTYPE_CLASSIFICATION_PROMPT_VERSION,
  MEALTYPE_CLASSIFICATION_SCHEMA_VERSION,
} from './recipe-mealtype-classifier.ports';
import {
  RecipeMealTypeClassifierService,
  RecipeMealTypeClassifierUnavailableException,
} from './recipe-mealtype-classifier.service';
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
  excludeCatalogRecipeFingerprints?: string[];
  onModelSelected?: (model: string) => void;
}

export interface WeeklyCompositionSnapshot extends Record<string, unknown> {
  compositionVersion: 'weekly-catalog-composition-v2';
  aiInvoked: boolean;
  classificationAi: {
    invoked: boolean;
    provider: string;
    model: string;
    models: string[];
    promptVersion: string;
    schemaVersion: string;
    pagesClassified: number;
    classifiedCount: number;
  };
  generationAi: {
    invoked: boolean;
    provider: string;
    model: string;
    generatedCount: number;
    batches: WeeklyCompositionSnapshot['batches'];
  };
  /** Retained at the top level for compatibility with existing composition audit readers. */
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
  /** Internal optimistic versions for catalog Recipes selected by this composition. */
  selectedRecipeVersions?: Map<string, Date>;
}

export type WeeklyRecipeEligibilityPolicy = (
  candidate: RecipeCoverageCandidate | Record<string, unknown>,
  slot: WeeklyMealSlot,
) => boolean;

export const WEEKLY_RECIPE_ELIGIBILITY_POLICY = Symbol('WEEKLY_RECIPE_ELIGIBILITY_POLICY');
export const WEEKLY_COMPOSITION_VERSION = 'weekly-catalog-composition-v2' as const;
const GENERATION_MEAL_ORDER = [MealType.BREAKFAST, MealType.LUNCH, MealType.SNACK, MealType.DINNER];
const RECIPE_CATALOG_PAGE_SIZE = 10;

// Compatibility fallback for direct composer tests without the production classifier wiring.
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
    @Optional() @Inject(RecipeRepository)
    private readonly recipeRepository?: Pick<RecipeRepository, 'findMealTypeCatalogPage'>,
    @Optional() @Inject(RecipeMealTypeClassifierService)
    private readonly classifier?: Pick<RecipeMealTypeClassifierService, 'classify'>,
  ) {
    super();
  }

  async composeWeeklyProposal(input: WeeklyProposalInput): Promise<WeeklyProposal> {
    const slots = buildWeeklySlots(input.weekStart);
    const hasRecipeRepository = Boolean(this.recipeRepository);
    const hasClassifier = Boolean(this.classifier);
    if (hasRecipeRepository !== hasClassifier) {
      throw new Error('NUT-76 catalog repository and meal-type classifier must be wired together');
    }
    const hasProductionClassifier = hasRecipeRepository && hasClassifier;
    const catalog = hasProductionClassifier
      ? await this.loadClassifiedCatalog(input, slots)
      : await this.loadPolicyCatalogCandidates(input.userId, slots, input.runId);
    const candidates = catalog.candidates;
    const assignedCatalog = catalog.assignments;
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
        if (!reusableRecipe || usedRecipeIds.has(reusableRecipe.id) || !catalog.isEligible(slot, reusableRecipe)) {
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

    const selectedRecipeVersions = new Map<string, Date>();
    for (const recipe of assignedCatalog.values()) {
      if (recipe.updatedAt instanceof Date) selectedRecipeVersions.set(recipe.id, recipe.updatedAt);
    }

    return {
      dto,
      comparableDays,
      summary,
      selectedRecipeVersions,
      compositionSnapshot: {
        compositionVersion: WEEKLY_COMPOSITION_VERSION,
        aiInvoked: catalog.classificationAi.invoked || generated.batches.length > 0,
        classificationAi: catalog.classificationAi,
        generationAi: {
          invoked: generated.batches.length > 0,
          provider: generated.batches.length > 0 ? OPENAI_PROVIDER : 'none',
          model: generated.batches[generated.batches.length - 1]?.model ?? 'none',
          generatedCount: generated.batches.reduce((total, batch) => total + batch.count, 0),
          batches: generated.batches,
        },
        batches: generated.batches,
      },
    };
  }

  private async loadPolicyCatalogCandidates(userId: string, slots: WeeklyMealSlot[], runId: string) {
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

    const recipeCandidates = [...candidates.values()];
    return {
      candidates: recipeCandidates as Recipe[],
      assignments: matchRecipesToSlots(
        slots,
        recipeCandidates,
        (slot, candidate) => this.isEligible(slot as WeeklyMealSlot, candidate),
      ) as Map<string, Recipe>,
      isEligible: (slot: WeeklyMealSlot, candidate: Recipe) => this.isEligible(slot, candidate),
      classificationAi: {
        invoked: false,
        provider: 'none',
        model: 'none',
        models: [],
        promptVersion: MEALTYPE_CLASSIFICATION_PROMPT_VERSION,
        schemaVersion: MEALTYPE_CLASSIFICATION_SCHEMA_VERSION,
        pagesClassified: 0,
        classifiedCount: 0,
      },
    };
  }

  private async loadClassifiedCatalog(input: WeeklyProposalInput, slots: WeeklyMealSlot[]) {
    const candidates: Recipe[] = [];
    const mealTypesByRecipeId = new Map<string, MealType[]>();
    const nutritionEligibleIds = new Set<string>();
    const excludedCatalogRecipeFingerprints = new Set(input.excludeCatalogRecipeFingerprints ?? []);
    let assignments = new Map<string, Recipe>();
    let afterId: string | undefined;
    let pagesClassified = 0;
    let classifiedCount = 0;
    let model = 'none';
    const models: string[] = [];

    if (!hasSupportedProfilePolicy(input.profile)) {
      return {
        candidates,
        assignments,
        isEligible: (_slot: WeeklyMealSlot, _recipe: Recipe) => false,
        classificationAi: {
          invoked: false,
          provider: 'none',
          model: 'none',
          models,
          promptVersion: MEALTYPE_CLASSIFICATION_PROMPT_VERSION,
          schemaVersion: MEALTYPE_CLASSIFICATION_SCHEMA_VERSION,
          pagesClassified,
          classifiedCount,
        },
      };
    }

    const forbiddenRestrictions = profileForbiddenRestrictions(input.profile);

    while (true) {
      let page: Recipe[];
      try {
        page = await this.recipeRepository!.findMealTypeCatalogPage({
          ...(afterId ? { afterId } : {}),
          limit: RECIPE_CATALOG_PAGE_SIZE,
        });
      } catch {
        await this.failRun(input.runId, input.userId, 'RECIPE_CATALOG_UNAVAILABLE');
        throw new ServiceUnavailableException('Recipe catalog is temporarily unavailable');
      }
      if (page.length === 0) break;

      const profileEligiblePage = page.filter(recipe =>
        !excludedCatalogRecipeFingerprints.has(recipeFingerprint(recipe)) &&
        (forbiddenRestrictions.length === 0 || !findExcludedIngredientInSource(recipe, forbiddenRestrictions)),
      );
      if (profileEligiblePage.length === 0) {
        afterId = page[page.length - 1].id;
        continue;
      }

      let pageClassifications: MealType[][];
      try {
        pageClassifications = await this.classifier!.classify(
          profileEligiblePage.map(({ title, ingredients }) => ({ title, ingredients })),
          async selectedModel => {
            model = selectedModel;
            if (!models.includes(selectedModel)) models.push(selectedModel);
            await this.recordSelectedModel(input, selectedModel);
          },
        );
      } catch (error) {
        if (error instanceof UnprocessableEntityException) {
          await this.validation.rejectWithCode(this.run(input, model === 'none' ? OPENAI_MODEL_NAME : model), 'AI_INVALID_SCHEMA');
          throw error;
        }
        if (error instanceof ServiceUnavailableException || error instanceof AiProviderUnavailableError) {
          const errorCode = error instanceof RecipeMealTypeClassifierUnavailableException || error instanceof AiProviderUnavailableError
            ? error.reason
            : 'AI_PROVIDER_ERROR';
          await this.failRun(input.runId, input.userId, errorCode);
          if (error instanceof ServiceUnavailableException) throw error;
          throw new ServiceUnavailableException('The AI provider is not available; retry later');
        }
        await this.failRun(input.runId, input.userId, 'AI_PROVIDER_ERROR');
        throw error;
      }

      if (model === 'none') {
        model = OPENAI_MODEL_NAME;
        if (!models.includes(model)) models.push(model);
        await this.recordSelectedModel(input, model);
      }

      pagesClassified += 1;
      classifiedCount += profileEligiblePage.length;
      candidates.push(...profileEligiblePage);
      profileEligiblePage.forEach((recipe, index) => {
        mealTypesByRecipeId.set(recipe.id, pageClassifications[index]);
        try {
          mapRecipeNutritionToMeal(recipe);
          nutritionEligibleIds.add(recipe.id);
        } catch {
          // A classifier edge cannot be used if the selected Recipe has no meal nutrition.
        }
      });

      assignments = matchRecipesToSlots(
        slots,
        candidates,
        (slot, recipe) => nutritionEligibleIds.has(recipe.id) &&
          (mealTypesByRecipeId.get(recipe.id) ?? []).includes((slot as WeeklyMealSlot).mealType),
      );
      if (assignments.size === slots.length) break;

      afterId = page[page.length - 1].id;
    }

    return {
      candidates,
      assignments,
      isEligible: (slot: WeeklyMealSlot, recipe: Recipe) => nutritionEligibleIds.has(recipe.id) &&
        (mealTypesByRecipeId.get(recipe.id) ?? []).includes(slot.mealType),
      classificationAi: {
        invoked: pagesClassified > 0,
        provider: pagesClassified > 0 ? OPENAI_PROVIDER : 'none',
        model,
        models,
        promptVersion: MEALTYPE_CLASSIFICATION_PROMPT_VERSION,
        schemaVersion: MEALTYPE_CLASSIFICATION_SCHEMA_VERSION,
        pagesClassified,
        classifiedCount,
      },
    };
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
          await this.recordSelectedModel(input, model);
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

  private async findReusableCandidate(id: string, candidates: Recipe[]) {
    const discovered = candidates.find(candidate => candidate.id === id);
    if (discovered) return discovered;
    return this.validation.findRecipeById(id) as Promise<Recipe | null>;
  }

  private buildDays(
    slots: WeeklyMealSlot[],
    assignedCatalog: Map<string, Recipe>,
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

  private async recordSelectedModel(input: WeeklyProposalInput, model: string): Promise<void> {
    if (typeof (this.repository as any).updatePendingGenerationRunModel === 'function') {
      const updated = await this.repository.updatePendingGenerationRunModel(input.runId, input.userId, model);
      if (updated === 0) throw new Error(`GenerationRun ${input.runId} is no longer pending`);
    }
    input.onModelSelected?.(model);
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
