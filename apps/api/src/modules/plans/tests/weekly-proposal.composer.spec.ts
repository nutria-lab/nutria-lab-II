import 'reflect-metadata';
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { DayOfWeek, MealType } from '../../../generated/prisma/client';
import { AiProviderUnavailableError } from '../../openai/openai.service';
import { RecipeValidationService } from '../recipe-validation.service';
import { OpenAIWeeklyProposalComposer } from '../weekly-proposal.composer';

type Slot = { key: string; date: string; day: DayOfWeek; mealType: MealType };
const { buildWeeklySlots } = require('../weekly-proposal-assignment') as {
  buildWeeklySlots: (weekStart: Date) => Slot[];
};

const weekStart = new Date('2026-09-14T00:00:00.000Z');
const profile: any = {
  goal: 'MAINTAIN',
  diet: 'ALL',
  excludedIngredients: [],
  cookTimePreference: 'QUICK',
};

function recipe(id: string, title = `Recipe ${id}`) {
  return {
    id,
    title,
    description: `Description ${title}`,
    prepMinutes: 10,
    cookMinutes: 15,
    ingredients: [{ name: `Ingredient ${id}`, quantity: 1, unit: 'g' }],
    instructions: ['Prepare'],
    categories: [],
    properties: [],
    nutritionalValues: { calories: 350, protein: 20, fiber: 8 },
  };
}

function generatedRecipe(index: number) {
  return {
    title: `Generated recipe ${index}`,
    description: `Generated description ${index}`,
    prepMinutes: 10,
    cookMinutes: 15,
    ingredients: [{ name: `Generated ingredient ${index}`, quantity: 1, unit: 'g' }],
    instructions: ['Prepare'],
    categories: [],
    properties: [],
    nutritionalValues: { calories: 350, protein: 20, fiber: 8 },
  };
}

function setup(options: {
  catalog?: any[];
  eligibleSlotByRecipeId?: Map<string, string>;
  eligibilityPolicy?: (candidate: any, slot: any) => boolean;
  providerResponse?: (count: number, callIndex: number) => string;
  providerError?: Error;
  profile?: any;
  recipeRepository?: any;
  classifier?: any;
} = {}) {
  const plans = { transitionGenerationRun: jest.fn().mockResolvedValue(1) };
  const recipeRepository = { findByNormalizedTitles: jest.fn().mockResolvedValue([]) };
  const validation = new RecipeValidationService(recipeRepository as any, plans as any);
  const catalog = options.catalog ?? [];
  const coverage = {
    evaluate: jest.fn(async (request: any) => {
      const excluded = new Set(request.excludeRecipeIds ?? []);
      const page = catalog.filter(item => !excluded.has(item.id)).slice(0, request.desiredTotal);
      return {
        result: {
          compatibleRecipes: page.map(recipe => ({ recipe, score: 0, matchReasons: [] })),
          desiredTotal: request.desiredTotal,
          compatibleCount: page.length,
          missingCount: Math.max(0, request.desiredTotal - page.length),
          normalizedCriteria: { categories: [], properties: [] },
        },
        warnings: [],
      };
    }),
  };
  let nextGeneratedIndex = 0;
  let callIndex = 0;
  const provider = {
    generate: jest.fn(async (input: any) => {
      const currentCall = callIndex++;
      if (options.providerError) throw options.providerError;
      if (options.providerResponse) return options.providerResponse(input.count, currentCall);
      const candidates = Array.from({ length: input.count }, () => generatedRecipe(nextGeneratedIndex++));
      return JSON.stringify({ recipes: candidates });
    }),
  };
  const eligible = options.eligibilityPolicy ?? (
    options.eligibleSlotByRecipeId
      ? (candidate: any, slot: any) => options.eligibleSlotByRecipeId?.get(candidate.id) === slot.key
      : undefined
  );
  const Composer = OpenAIWeeklyProposalComposer as any;
  const composer = new Composer(
    plans as any,
    coverage as any,
    provider as any,
    validation,
    eligible as any,
    options.recipeRepository as any,
    options.classifier as any,
  );
  const compose = () => composer.composeWeeklyProposal({
    userId: 'user-1',
    runId: 'run-1',
    profile: options.profile ?? profile,
    weekStart,
    weekStartStr: '2026-09-14',
  } as any);

  return { plans, recipeRepository, validation, coverage, provider, compose };
}

function candidateCatalogForSlots(limit = 28, missingSlotIndices: number[] = []) {
  const slots = buildWeeklySlots(weekStart);
  const coveredIndices = slots.map((_, index) => index).filter(index => !missingSlotIndices.includes(index)).slice(0, limit);
  const catalog = coveredIndices.map(index => recipe(`catalog-${index}`));
  const eligibleSlotByRecipeId = new Map<string, string>(
    catalog.map((item, index) => [item.id, slots[coveredIndices[index]].key] as [string, string]),
  );
  return { slots, catalog, eligibleSlotByRecipeId };
}

function mealsOf(proposal: any) {
  return proposal.dto.days.flatMap((day: any) => day.meals);
}

describe('OpenAIWeeklyProposalComposer catalog-first composition (NUT-76)', () => {
  it('uses a fully covered catalog without calling the provider and preserves each existing Recipe ID', async () => {
    const { catalog, eligibleSlotByRecipeId } = candidateCatalogForSlots();
    const { coverage, provider, compose } = setup({ catalog, eligibleSlotByRecipeId });

    const proposal = await compose();

    expect(mealsOf(proposal)).toHaveLength(28);
    expect(provider.generate).not.toHaveBeenCalled();
    expect(mealsOf(proposal).map((meal: any) => meal.reuseRecipeId)).toEqual(catalog.map(({ id }) => id));
    expect(mealsOf(proposal).every((meal: any) => meal.recipe === undefined)).toBe(true);
    expect(coverage.evaluate.mock.calls.every(([request]) => request.desiredTotal <= 10)).toBe(true);
    expect(coverage.evaluate.mock.calls.length).toBeGreaterThan(1);
    for (const [request] of coverage.evaluate.mock.calls) {
      const excludedIds = request.excludeRecipeIds ?? [];
      expect(new Set(excludedIds).size).toBe(excludedIds.length);
    }
  });

  it('requests exactly the partial catalog deficit from the provider', async () => {
    const { catalog, eligibleSlotByRecipeId } = candidateCatalogForSlots(28, [1, 5, 9]);
    const { provider, compose } = setup({ catalog, eligibleSlotByRecipeId });

    const proposal = await compose();

    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(provider.generate.mock.calls.map(([input]) => input.count)).toEqual([3]);
    expect(provider.generate.mock.calls[0][0].criteria.mealType).toBe(MealType.LUNCH);
    expect(mealsOf(proposal)).toHaveLength(28);
    expect(mealsOf(proposal).filter((meal: any) => meal.reuseRecipeId)).toHaveLength(25);
    expect(mealsOf(proposal).filter((meal: any) => meal.recipe)).toHaveLength(3);
  });

  it('requests an empty catalog deficit in homogeneous meal-type batches', async () => {
    const { provider, compose } = setup();

    const proposal = await compose();

    expect(provider.generate.mock.calls.map(([input]) => input.count)).toEqual([7, 7, 7, 7]);
    expect(provider.generate.mock.calls.every(([input]) => input.count <= 10)).toBe(true);
    expect(new Set(provider.generate.mock.calls.map(([input]) => input.criteria.mealType)).size).toBe(4);
    expect(mealsOf(proposal)).toHaveLength(28);
    expect(mealsOf(proposal).every((meal: any) => meal.reuseRecipeId === undefined)).toBe(true);
  });

  it('keeps catalog paging IDs scoped to one query and excludes prior pages without duplicate discovery', async () => {
    const { catalog, eligibleSlotByRecipeId } = candidateCatalogForSlots();
    const { coverage, compose } = setup({ catalog, eligibleSlotByRecipeId });

    await compose();

    const calls = coverage.evaluate.mock.calls.map(([request]) => request);
    expect(calls.length).toBe(3);
    expect(calls.map(request => request.desiredTotal)).toEqual([10, 10, 10]);
    expect(calls[0].excludeRecipeIds ?? []).toEqual([]);
    expect(calls[1].excludeRecipeIds).toHaveLength(10);
    expect(calls[2].excludeRecipeIds).toHaveLength(20);
    expect(calls[2].excludeRecipeIds).toEqual(catalog.slice(0, 20).map(({ id }) => id));
  });

  it('fails closed when titles, categories, or properties merely suggest a meal type', async () => {
    const suggestiveCatalog = Array.from({ length: 28 }, (_, index) => ({
      ...recipe(`suggestive-${index}`, `Breakfast ${index}`),
      categories: ['HIGH_PROTEIN'],
      properties: ['BREAKFAST'],
    }));
    const { provider, compose } = setup({ catalog: suggestiveCatalog });

    const proposal = await compose();

    expect(provider.generate.mock.calls.map(([input]) => input.count)).toEqual([7, 7, 7, 7]);
    expect(mealsOf(proposal).every((meal: any) => meal.reuseRecipeId === undefined)).toBe(true);
  });

  it('keeps NUT-74 legacy profile behavior when an excluded ingredient appears in an AI draft', async () => {
    const dairyProfile = { ...profile, excludedIngredients: ['DAIRY'] };
    const dairyDraft = {
      ...generatedRecipe(0),
      ingredients: [{ name: 'Milk', quantity: 1, unit: 'g' }],
    };
    const { provider, compose } = setup({
      catalog: candidateCatalogForSlots(27).catalog,
      eligibleSlotByRecipeId: candidateCatalogForSlots(27).eligibleSlotByRecipeId,
      profile: dairyProfile,
      providerResponse: () => JSON.stringify({ recipes: [dairyDraft] }),
    });

    const proposal = await compose();

    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({ profile: dairyProfile }), expect.any(Function));
    expect(mealsOf(proposal)).toHaveLength(28);
  });

  it('does not treat a technical coverage failure as an empty catalog', async () => {
    const { coverage, provider, compose } = setup();
    coverage.evaluate.mockRejectedValueOnce(new Error('catalog database unavailable'));

    await expect(compose()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it.each([
    ['catalog repository without classifier', { recipeRepository: { findMealTypeCatalogPage: jest.fn() } }],
    ['classifier without catalog repository', { classifier: { classify: jest.fn() } }],
  ])('fails fast for partial production classifier wiring: %s', async (_description, partialWiring) => {
    const { catalog } = candidateCatalogForSlots();
    const { compose } = setup({
      catalog,
      eligibilityPolicy: () => true,
      ...partialWiring,
    });

    await expect(compose()).rejects.toThrow();
  });

  it('maps provider unavailability to 503 and records the failed run', async () => {
    const { plans, compose } = setup({ providerError: new AiProviderUnavailableError('AI_TIMEOUT') });

    await expect(compose()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(plans.transitionGenerationRun).toHaveBeenCalledWith(
      'run-1', 'user-1', ['PENDING'], 'FAILED', { errorCode: 'AI_TIMEOUT' },
    );
  });

  it('rejects invalid provider JSON through the existing validation run path', async () => {
    const { plans, compose } = setup({ providerResponse: () => 'not json' });

    await expect(compose()).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(plans.transitionGenerationRun).toHaveBeenCalledWith(
      'run-1', 'user-1', ['PENDING'], 'REJECTED', expect.objectContaining({ errorCode: 'INVALID_JSON' }),
    );
  });

  it('rejects provider count mismatch rather than silently retrying or filling by repetition', async () => {
    const { plans, provider, compose } = setup({
      providerResponse: count => JSON.stringify({ recipes: Array.from({ length: count - 1 }, (_, index) => generatedRecipe(index)) }),
    });

    await expect(compose()).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(provider.generate.mock.calls[0][0].count).toBe(7);
    expect(plans.transitionGenerationRun).toHaveBeenCalledWith(
      'run-1', 'user-1', ['PENDING'], 'REJECTED', expect.objectContaining({ errorCode: 'COUNT_MISMATCH' }),
    );
  });

  it('sends all provider batches through the real NUT-74 service and rejects if too few drafts are valid', async () => {
    const invalidDraft = { ...generatedRecipe(0), categories: ['UNSUPPORTED_CATEGORY'] };
    const { plans, validation, provider, compose } = setup({
      providerResponse: count => JSON.stringify({ recipes: Array.from({ length: count }, () => invalidDraft) }),
    });
    const validateDrafts = jest.spyOn(validation, 'validateDrafts');

    await expect(compose()).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(provider.generate.mock.calls.map(([input]) => input.count)).toEqual([7, 7, 7, 7]);
    expect(validateDrafts).toHaveBeenCalledTimes(1);
    expect(validateDrafts.mock.calls[0][0]).toHaveLength(28);
    expect(plans.transitionGenerationRun).toHaveBeenCalledWith(
      'run-1', 'user-1', ['PENDING'], 'REJECTED', expect.objectContaining({ errorCode: 'UNSUPPORTED_CATEGORY' }),
    );
  });

  it('rejects an exact duplicate that appears across separate provider batches', async () => {
    const plans = { transitionGenerationRun: jest.fn().mockResolvedValue(1) };
    const recipeRepository = { findByNormalizedTitles: jest.fn().mockResolvedValue([]) };
    const validation = new RecipeValidationService(recipeRepository as any, plans as any);
    let next = 0;
    const duplicate = generatedRecipe(0);
    const provider = {
      generate: jest.fn(async ({ count }: any) => {
        const batch = Array.from({ length: count }, () => {
          const current = next++;
          return current === 7 ? duplicate : generatedRecipe(current);
        });
        return JSON.stringify({ recipes: batch });
      }),
    };
    const coverage = { evaluate: jest.fn().mockResolvedValue({ result: { compatibleRecipes: [] }, warnings: [] }) };
    const Composer = OpenAIWeeklyProposalComposer as any;
    const composer = new Composer(plans as any, coverage as any, provider as any, validation, undefined as any);

    await expect(composer.composeWeeklyProposal({
      userId: 'user-1', runId: 'run-1', profile, weekStart, weekStartStr: '2026-09-14',
    } as any)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
