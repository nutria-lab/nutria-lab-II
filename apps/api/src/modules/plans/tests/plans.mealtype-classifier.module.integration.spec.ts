import 'reflect-metadata';
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MealType } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RecipeRepository } from '../../recipe/recipe.repository';
import { recipeFingerprint } from '../../recipe/recipe-fingerprint.util';
import {
  findExcludedIngredientInSource,
  hasSupportedProfilePolicy,
  profileForbiddenRestrictions,
} from '../../recipe/validation/ingredient-dictionary';
import { RecipeMealTypeClassifierService } from '../recipe-mealtype-classifier.service';
import {
  RECIPE_MEALTYPE_CLASSIFICATION_PROVIDER,
} from '../recipe-mealtype-classifier.ports';
import { PlansModule } from '../plans.module';
import { OpenAIWeeklyProposalComposer, WeeklyProposalComposer } from '../weekly-proposal.composer';
import { RECIPE_GENERATION_PROVIDER } from '../../recipe-generation/recipe-generation.ports';
import { AiProviderUnavailableError } from '../../openai/openai.service';

const weekStart = new Date('2026-09-14T00:00:00.000Z');
const mealTypes = [MealType.BREAKFAST, MealType.LUNCH, MealType.SNACK, MealType.DINNER];

function catalogRecipe(index: number) {
  return {
    id: `catalog-${String(index).padStart(2, '0')}`,
    title: `Catalog recipe ${index}`,
    description: 'Catalog description',
    prepMinutes: 10,
    cookMinutes: 10,
    ingredients: [{ name: `Ingredient ${index}`, quantity: 1, unit: 'g' }],
    instructions: ['Prepare'],
    categories: [],
    properties: [],
    nutritionalValues: { calories: 350, protein: 20, fiber: 8 },
    origin: 'MANUAL',
    generationRunId: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  };
}

function generatedRecipe(index: number) {
  return {
    title: `Generated recipe ${index}`,
    description: `Generated description ${index}`,
    prepMinutes: 10,
    cookMinutes: 10,
    ingredients: [{ name: `Generated ingredient ${index}`, quantity: 1, unit: 'g' }],
    instructions: ['Prepare'],
    categories: [],
    properties: [],
    nutritionalValues: { calories: 350, protein: 20, fiber: 8 },
  };
}

async function createPlansModule(
  queryRaw: jest.Mock,
  classifierProvider: { classify: jest.Mock },
  generationProvider?: { generate: jest.Mock },
  generationRunUpdateMany = jest.fn().mockResolvedValue({ count: 1 }),
  mealPlanCreate = jest.fn(),
) {
  const builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => ({ JWT_SECRET: 'test-secret', OPENAI_API_KEY: 'test-key' })],
      }),
      PlansModule,
    ],
  })
    .overrideProvider(PrismaService)
    .useValue({
      $queryRaw: queryRaw,
      $disconnect: jest.fn(),
      generationRun: { updateMany: generationRunUpdateMany },
      mealPlan: { create: mealPlanCreate },
    })
    .overrideProvider(RECIPE_MEALTYPE_CLASSIFICATION_PROVIDER)
    .useValue(classifierProvider);
  if (generationProvider) {
    builder.overrideProvider(RECIPE_GENERATION_PROVIDER).useValue(generationProvider);
  }
  return builder.compile();
}

function classifyByCatalogIndex() {
  return jest.fn(async (
    inputs: Array<{ title: string; ingredients: unknown[] }>,
    onModelSelected?: (model: string) => void | Promise<void>,
  ) => {
    await onModelSelected?.('classification-test-model');
    return JSON.stringify({
      classifications: inputs.map(({ title }) => {
        const index = Number(title.replace('Catalog recipe ', ''));
        return index < 28 ? [mealTypes[Math.floor(index / 7)]] : [];
      }),
    });
  });
}

function classifyFirstTwentyFive() {
  return jest.fn(async (
    inputs: Array<{ title: string; ingredients: unknown[] }>,
    onModelSelected?: (model: string) => void | Promise<void>,
  ) => {
    await onModelSelected?.('classification-test-model');
    return JSON.stringify({
      classifications: inputs.map(({ title }) => {
        const index = Number(title.replace('Catalog recipe ', ''));
        return index < 25 ? [mealTypes[Math.floor(index / 7)]] : [];
      }),
    });
  });
}

function classifyCatalogByMealType() {
  return jest.fn(async (
    inputs: Array<{ title: string; ingredients: unknown[] }>,
    onModelSelected?: (model: string) => void | Promise<void>,
  ) => {
    await onModelSelected?.('classification-test-model');
    return JSON.stringify({
      classifications: inputs.map(({ title }) => {
        const match = /^(?:Catalog recipe|Catalog alternative) (\d+)$/.exec(title);
        if (!match) return [];
        const index = Number(match[1]);
        return [mealTypes[Math.floor(index / 7)]];
      }),
    });
  });
}

function compositionInput() {
  return {
    userId: 'user-1',
    runId: 'run-1',
    profile: { goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'QUICK' } as any,
    weekStart,
    weekStartStr: '2026-09-14',
  };
}

describe('NUT-76 PlansModule classifier production wiring', () => {
  it('uses the default composer and classifier service to reuse catalog pages without generation', async () => {
    const catalog = Array.from({ length: 31 }, (_, index) => catalogRecipe(index));
    const queryRaw = jest.fn()
      .mockResolvedValueOnce(catalog.slice(0, 10))
      .mockResolvedValueOnce(catalog.slice(10, 20))
      .mockResolvedValueOnce(catalog.slice(20, 30));
    const classify = classifyByCatalogIndex();
    const classifierProvider = { classify };
    const generationProvider = { generate: jest.fn() };

    const module = await createPlansModule(queryRaw, classifierProvider, generationProvider);

    try {
      const composer = module.get(WeeklyProposalComposer);
      const classifier = module.get(RecipeMealTypeClassifierService);
      const proposal = await composer.composeWeeklyProposal(compositionInput());

      expect(composer).toBeInstanceOf(OpenAIWeeklyProposalComposer);
      expect(classifier).toBeInstanceOf(RecipeMealTypeClassifierService);
      expect(classify).toHaveBeenCalledTimes(3);
      expect(classify.mock.calls.map(([page]) => page).map(page => page.length)).toEqual([10, 10, 10]);
      expect(classify.mock.calls.flatMap(([page]) => page).map(recipe => recipe.title)).toEqual(catalog.slice(0, 30).map(recipe => recipe.title));
      expect(queryRaw).toHaveBeenCalledTimes(3);
      expect(generationProvider.generate).not.toHaveBeenCalled();
      expect(proposal.dto.days).toHaveLength(7);
      expect(proposal.dto.days.flatMap(day => day.meals)).toHaveLength(28);
      expect(new Set((proposal.dto.days.flatMap(day => day.meals) as any[]).map(meal => meal.reuseRecipeId))).toEqual(
        new Set(catalog.slice(0, 28).map(recipe => recipe.id)),
      );
      expect(proposal.compositionSnapshot).toMatchObject({
        classificationAi: expect.objectContaining({
          invoked: true,
          provider: 'openai',
          model: 'classification-test-model',
          classifiedCount: 30,
        }),
        generationAi: expect.objectContaining({ invoked: false, provider: 'none', model: 'none' }),
      });
      const meals = proposal.dto.days.flatMap(day => day.meals) as any[];
      for (const [dayIndex, day] of proposal.dto.days.entries()) {
        const expectedIdByMealType = new Map(mealTypes.map((type, typeIndex) => [
          type,
          catalogRecipe(typeIndex * 7 + (6 - dayIndex)).id,
        ]));
        for (const meal of day.meals as any[]) {
          expect(meal.reuseRecipeId).toBe(expectedIdByMealType.get(meal.mealType));
        }
      }
      expect(meals).toHaveLength(28);
      expect(proposal.compositionSnapshot?.classificationAi).not.toEqual(proposal.compositionSnapshot?.generationAi);
    } finally {
      await module.close();
    }
  });

  it('generates only the three dinner deficits after the catalog page sequence is exhausted', async () => {
    const catalog = Array.from({ length: 25 }, (_, index) => catalogRecipe(index));
    const queryRaw = jest.fn()
      .mockResolvedValueOnce(catalog.slice(0, 10))
      .mockResolvedValueOnce(catalog.slice(10, 20))
      .mockResolvedValueOnce(catalog.slice(20, 25))
      .mockResolvedValue([]);
    const classify = classifyFirstTwentyFive();
    let generatedIndex = 0;
    const generationProvider = {
      generate: jest.fn(async (
        { count }: { count: number },
        onModelSelected?: (model: string) => void | Promise<void>,
      ) => {
        await onModelSelected?.('generation-test-model');
        return JSON.stringify({ recipes: Array.from({ length: count }, () => generatedRecipe(generatedIndex++)) });
      }),
    };
    const module = await createPlansModule(queryRaw, { classify }, generationProvider);

    try {
      const proposal = await module.get(WeeklyProposalComposer).composeWeeklyProposal(compositionInput());

      expect(classify).toHaveBeenCalledTimes(3);
      expect(classify.mock.calls.map(([page]) => page.length)).toEqual([10, 10, 5]);
      expect(generationProvider.generate).toHaveBeenCalledTimes(1);
      expect(generationProvider.generate.mock.calls[0][0]).toMatchObject({
        count: 3,
        criteria: { mealType: MealType.DINNER },
      });
      expect(proposal.dto.days.flatMap(day => day.meals)).toHaveLength(28);
      expect((proposal.dto.days.flatMap(day => day.meals) as any[]).filter(meal => meal.reuseRecipeId)).toHaveLength(25);
      expect(proposal.compositionSnapshot).toMatchObject({
        classificationAi: expect.objectContaining({ invoked: true, model: 'classification-test-model', classifiedCount: 25 }),
        generationAi: expect.objectContaining({ invoked: true, model: 'generation-test-model', generatedCount: 3 }),
      });
    } finally {
      await module.close();
    }
  });

  it('keeps classification unused for an empty catalog and generates all 28 meals in homogeneous batches', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const classify = jest.fn();
    let generatedIndex = 0;
    const generationProvider = {
      generate: jest.fn(async (
        { count }: { count: number },
        onModelSelected?: (model: string) => void | Promise<void>,
      ) => {
        await onModelSelected?.('generation-test-model');
        return JSON.stringify({ recipes: Array.from({ length: count }, () => generatedRecipe(generatedIndex++)) });
      }),
    };
    const module = await createPlansModule(queryRaw, { classify }, generationProvider);

    try {
      const proposal = await module.get(WeeklyProposalComposer).composeWeeklyProposal(compositionInput());

      expect(classify).not.toHaveBeenCalled();
      expect(generationProvider.generate.mock.calls.map(([input]) => input.count)).toEqual([7, 7, 7, 7]);
      expect(generationProvider.generate.mock.calls.every(([input]) => input.count <= 10)).toBe(true);
      expect(proposal.dto.days.flatMap(day => day.meals)).toHaveLength(28);
      expect(proposal.compositionSnapshot).toMatchObject({
        classificationAi: expect.objectContaining({ invoked: false, classifiedCount: 0 }),
        generationAi: expect.objectContaining({ invoked: true, model: 'generation-test-model', generatedCount: 28 }),
      });
    } finally {
      await module.close();
    }
  });

  it('skips catalog fingerprint duplicates and reaches distinct full coverage on the second PlansModule composition', async () => {
    const originalRecipes = Array.from({ length: 28 }, (_, index) => catalogRecipe(index));
    const unclassifiedFillers = Array.from({ length: 2 }, (_, index) => ({
      ...catalogRecipe(28 + index),
      title: `Catalog filler ${index}`,
    }));
    const fingerprintDuplicates = originalRecipes.map((recipe, index) => ({
      ...recipe,
      id: `catalog-${String(30 + index).padStart(2, '0')}`,
    }));
    const distinctAlternatives = Array.from({ length: 28 }, (_, index) => ({
      ...catalogRecipe(58 + index),
      title: `Catalog alternative ${index}`,
      ingredients: [{ name: `Alternative ingredient ${index}`, quantity: 1, unit: 'g' }],
    }));
    const catalog = [...originalRecipes, ...unclassifiedFillers, ...fingerprintDuplicates, ...distinctAlternatives];
    const queryRaw = jest.fn()
      .mockResolvedValueOnce(catalog.slice(0, 10))
      .mockResolvedValueOnce(catalog.slice(10, 20))
      .mockResolvedValueOnce(catalog.slice(20, 30))
      .mockResolvedValueOnce(catalog.slice(0, 10))
      .mockResolvedValueOnce(catalog.slice(10, 20))
      .mockResolvedValueOnce(catalog.slice(20, 30))
      .mockResolvedValueOnce(catalog.slice(30, 40))
      .mockResolvedValueOnce(catalog.slice(40, 50))
      .mockResolvedValueOnce(catalog.slice(50, 60))
      .mockResolvedValueOnce(catalog.slice(60, 70))
      .mockResolvedValueOnce(catalog.slice(70, 80))
      .mockResolvedValueOnce(catalog.slice(80, 86))
      .mockResolvedValue([]);
    const classify = classifyCatalogByMealType();
    const generationProvider = { generate: jest.fn() };
    const module = await createPlansModule(queryRaw, { classify }, generationProvider);

    try {
      const composer = module.get(WeeklyProposalComposer);
      const firstProposal = await composer.composeWeeklyProposal(compositionInput());
      const firstIds = firstProposal.dto.days.flatMap(day => day.meals)
        .flatMap((meal: any) => meal.reuseRecipeId ? [meal.reuseRecipeId] : []);
      const firstFingerprints = firstProposal.comparableDays.flatMap(day => day.meals)
        .map((meal: any) => recipeFingerprint(meal.recipe));

      expect(queryRaw).toHaveBeenCalledTimes(3);
      expect(new Set(firstIds)).toEqual(new Set(originalRecipes.map(recipe => recipe.id)));
      const firstClassificationCallCount = classify.mock.calls.length;

      const secondProposal = await composer.composeWeeklyProposal({
        ...compositionInput(),
        excludeCatalogRecipeFingerprints: firstFingerprints,
      } as any);
      const secondIds = secondProposal.dto.days.flatMap(day => day.meals)
        .flatMap((meal: any) => meal.reuseRecipeId ? [meal.reuseRecipeId] : []);
      const secondFingerprints = secondProposal.comparableDays.flatMap(day => day.meals)
        .map((meal: any) => recipeFingerprint(meal.recipe));
      const secondClassifiedTitles = classify.mock.calls.slice(firstClassificationCallCount)
        .flatMap(([page]) => page.map((recipe: any) => recipe.title));

      expect(firstIds).toHaveLength(28);
      expect(secondIds).toHaveLength(28);
      expect(secondFingerprints).toHaveLength(28);
      expect(secondFingerprints.some(fingerprint => firstFingerprints.includes(fingerprint))).toBe(false);
      expect(secondClassifiedTitles).toEqual([
        ...unclassifiedFillers.map(recipe => recipe.title),
        ...distinctAlternatives.map(recipe => recipe.title),
      ]);
      expect(generationProvider.generate).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });

  it('filters a classified catalog recipe whose ingredient matches the user exclusion without sending profile to classification', async () => {
    const catalog = Array.from({ length: 28 }, (_, index) => catalogRecipe(index));
    catalog[0] = {
      ...catalog[0],
      ingredients: [{ name: 'Milk', quantity: 1, unit: 'g' }],
    };
    const queryRaw = jest.fn()
      .mockResolvedValueOnce(catalog.slice(0, 10))
      .mockResolvedValueOnce(catalog.slice(10, 20))
      .mockResolvedValueOnce(catalog.slice(20, 28))
      .mockResolvedValue([]);
    const classify = classifyByCatalogIndex();
    let generatedIndex = 0;
    const generationProvider = {
      generate: jest.fn(async (
        { count }: { count: number },
        onModelSelected?: (model: string) => void | Promise<void>,
      ) => {
        await onModelSelected?.('generation-test-model');
        return JSON.stringify({ recipes: Array.from({ length: count }, () => generatedRecipe(generatedIndex++)) });
      }),
    };
    const module = await createPlansModule(queryRaw, { classify }, generationProvider);
    const input = compositionInput();
    input.profile.excludedIngredients = ['DAIRY'];
    const restrictions = profileForbiddenRestrictions(input.profile);

    try {
      const proposal = await module.get(WeeklyProposalComposer).composeWeeklyProposal(input);
      const meals = proposal.dto.days.flatMap(day => day.meals) as any[];
      const reusedIds = meals.flatMap(meal => meal.reuseRecipeId ? [meal.reuseRecipeId] : []);

      expect(findExcludedIngredientInSource(catalog[0], restrictions)).toBe('dairy');
      expect(classify.mock.calls.flatMap(([page]) => page).every(recipe =>
        Object.keys(recipe).sort().join(',') === 'ingredients,title',
      )).toBe(true);
      expect(reusedIds).toHaveLength(27);
      expect(reusedIds).not.toContain('catalog-00');
      expect(generationProvider.generate.mock.calls.map(([generationInput]) => generationInput.count)).toEqual([1]);
      expect(meals.filter(meal => meal.recipe)).toHaveLength(1);
    } finally {
      await module.close();
    }
  });

  it.each(['KETO', 'PALEO'] as const)(
    'skips catalog reuse for unsupported %s profile policy and generates the full plan',
    async diet => {
      const catalog = Array.from({ length: 28 }, (_, index) => catalogRecipe(index));
      const queryRaw = jest.fn()
        .mockResolvedValueOnce(catalog.slice(0, 10))
        .mockResolvedValueOnce(catalog.slice(10, 20))
        .mockResolvedValueOnce(catalog.slice(20, 28))
        .mockResolvedValue([]);
      const classify = classifyByCatalogIndex();
      let generatedIndex = 0;
      const generationProvider = {
        generate: jest.fn(async (
          { count }: { count: number; profile: { diet: string } },
          onModelSelected?: (model: string) => void | Promise<void>,
        ) => {
          await onModelSelected?.('generation-test-model');
          return JSON.stringify({ recipes: Array.from({ length: count }, () => generatedRecipe(generatedIndex++)) });
        }),
      };
      const module = await createPlansModule(queryRaw, { classify }, generationProvider);
      const findMealTypeCatalogPage = jest.spyOn(module.get(RecipeRepository), 'findMealTypeCatalogPage');
      const input = compositionInput();
      input.profile.diet = diet as any;

      try {
        const proposal = await module.get(WeeklyProposalComposer).composeWeeklyProposal(input);
        const meals = proposal.dto.days.flatMap(day => day.meals) as any[];

        expect(hasSupportedProfilePolicy(input.profile)).toBe(false);
        expect(findMealTypeCatalogPage).not.toHaveBeenCalled();
        expect(queryRaw.mock.calls.some(([template]) => template.join(' ').includes('"prepMinutes", "cookMinutes"'))).toBe(false);
        expect(classify).not.toHaveBeenCalled();
        expect(meals).toHaveLength(28);
        expect(meals.every(meal => meal.reuseRecipeId === undefined)).toBe(true);
        expect(generationProvider.generate.mock.calls.map(([generationInput]) => generationInput.count)).toEqual([7, 7, 7, 7]);
        expect(generationProvider.generate.mock.calls.every(([generationInput]) => generationInput.profile.diet === diet)).toBe(true);
      } finally {
        await module.close();
      }
    },
  );

  it('rejects a classifier refusal recoverably, records the run failure, and never writes a plan', async () => {
    const queryRaw = jest.fn().mockResolvedValue([catalogRecipe(0)]);
    const classify = jest.fn().mockResolvedValue(JSON.stringify({ refusal: 'classification is uncertain' }));
    const generationProvider = { generate: jest.fn() };
    const generationRunUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const mealPlanCreate = jest.fn();
    const module = await createPlansModule(
      queryRaw,
      { classify },
      generationProvider,
      generationRunUpdateMany,
      mealPlanCreate,
    );

    try {
      await expect(module.get(WeeklyProposalComposer).composeWeeklyProposal(compositionInput()))
        .rejects.toBeInstanceOf(UnprocessableEntityException);

      expect(classify).toHaveBeenCalledTimes(1);
      expect(generationProvider.generate).not.toHaveBeenCalled();
      expect(generationRunUpdateMany).toHaveBeenCalled();
      expect(generationRunUpdateMany.mock.calls.every(([input]) => input.data.status !== 'SUCCEEDED')).toBe(true);
      expect(mealPlanCreate).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });

  it('preserves classifier timeout reason in the failed GenerationRun while surfacing HTTP 503', async () => {
    const queryRaw = jest.fn().mockResolvedValue([catalogRecipe(0)]);
    const classify = jest.fn().mockRejectedValue(new AiProviderUnavailableError('AI_TIMEOUT'));
    const generationProvider = { generate: jest.fn() };
    const generationRunUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const mealPlanCreate = jest.fn();
    const module = await createPlansModule(
      queryRaw,
      { classify },
      generationProvider,
      generationRunUpdateMany,
      mealPlanCreate,
    );

    try {
      const composition = module.get(WeeklyProposalComposer).composeWeeklyProposal(compositionInput());

      await expect(composition).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(await composition.catch(error => error.getStatus())).toBe(503);
      expect(classify).toHaveBeenCalledTimes(1);
      expect(generationProvider.generate).not.toHaveBeenCalled();
      expect(generationRunUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['PENDING'] } }),
        data: expect.objectContaining({ status: 'FAILED', errorCode: 'AI_TIMEOUT' }),
      }));
      expect(mealPlanCreate).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });

});
