import { Diet, DietaryRestriction } from '@/generated/prisma/client';
import { NutritionProfileRepository } from '@/modules/nutrition-profile/nutrition-profile.repository';
import { RecipeCoverageService } from '../recipe-coverage.service';
import { RecipeRepository } from '../recipe.repository';

const recipe = (overrides: Record<string, unknown> = {}) => ({
  id: 'recipe-a',
  title: 'Avena con Banana',
  description: 'Desayuno fácil',
  prepMinutes: 15,
  cookMinutes: 0,
  ingredients: [{ name: 'Avena' }, { name: 'Banana' }],
  instructions: [],
  categories: ['VEGAN'],
  properties: ['Sin Gluten', 'Alto en Fibra'],
  nutritionalValues: null,
  origin: 'MANUAL',
  generationRunId: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const completeProfile = (overrides: Record<string, unknown> = {}) => ({
  id: 'profile-1',
  userId: 'user-1',
  goal: 'MAINTAIN',
  diet: Diet.ALL,
  excludedIngredients: [],
  cookTimePreference: 'STANDARD',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const mockRecipeRepository = {
  findCoverageCandidates: jest.fn(),
};

const mockProfileRepository = {
  findByUserId: jest.fn(),
};

describe('RecipeCoverageService', () => {
  let service: RecipeCoverageService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RecipeCoverageService(
      mockRecipeRepository as unknown as RecipeRepository,
      mockProfileRepository as unknown as NutritionProfileRepository,
    );
    mockProfileRepository.findByUserId.mockResolvedValue(completeProfile());
    mockRecipeRepository.findCoverageCandidates.mockResolvedValue([]);
  });

  it('returns complete coverage, a zero missing count, and never exceeds desiredTotal', async () => {
    mockRecipeRepository.findCoverageCandidates.mockResolvedValue([
      recipe({ id: 'recipe-b' }),
      recipe({ id: 'recipe-a' }),
      recipe({ id: 'recipe-c' }),
    ]);

    const evaluation = await service.evaluate({ userId: 'user-1', desiredTotal: 2 });

    expect(evaluation.result.compatibleRecipes.map((item: { recipe: { id: string } }) => item.recipe.id)).toEqual([
      'recipe-a',
      'recipe-b',
    ]);
    expect(evaluation.result.compatibleCount).toBe(2);
    expect(evaluation.result.missingCount).toBe(0);
    expect(evaluation.result.missingCount === 0).toBe(true);
    expect(evaluation.result.desiredTotal).toBe(2);
  });

  it.each([
    { candidates: [recipe()], desiredTotal: 3, expectedMissing: 2 },
    { candidates: [], desiredTotal: 3, expectedMissing: 3 },
  ])('calculates the exact missing count for partial and empty catalog coverage', async ({ candidates, desiredTotal, expectedMissing }) => {
    mockRecipeRepository.findCoverageCandidates.mockResolvedValue(candidates);

    const evaluation = await service.evaluate({ userId: 'user-1', desiredTotal });

    expect(evaluation.result.compatibleCount).toBe(candidates.length);
    expect(evaluation.result.missingCount).toBe(expectedMissing);
  });

  it.each([0, 1.5, 11, Number.NaN])('rejects invalid desired totals before profile or recipe I/O: %p', async desiredTotal => {
    await expect(service.evaluate({ userId: 'user-1', desiredTotal })).rejects.toThrow();

    expect(mockProfileRepository.findByUserId).not.toHaveBeenCalled();
    expect(mockRecipeRepository.findCoverageCandidates).not.toHaveBeenCalled();
  });

  it('loads the persisted profile exactly once and translates only safely representable diet and restriction gates', async () => {
    mockProfileRepository.findByUserId.mockResolvedValue(
      completeProfile({
        diet: Diet.VEGETARIAN,
        excludedIngredients: [DietaryRestriction.GLUTEN, DietaryRestriction.DAIRY],
      }),
    );

    await service.evaluate({
      userId: 'user-1',
      desiredTotal: 1,
      categories: ['VEGETARIAN', 'VEGETARIAN'],
      properties: [' sin gluten ', 'SIN GLUTEN', 'Alto   en Fibra'],
      maxPrepMinutes: 30,
      excludeRecipeIds: ['used-1', 'used-1'],
    });

    expect(mockProfileRepository.findByUserId).toHaveBeenCalledTimes(1);
    expect(mockProfileRepository.findByUserId).toHaveBeenCalledWith('user-1');
    expect(mockRecipeRepository.findCoverageCandidates).toHaveBeenCalledWith({
      topic: undefined,
      categories: ['VEGETARIAN'],
      properties: ['sin gluten', 'Alto en Fibra'],
      maxPrepMinutes: 30,
      excludeRecipeIds: ['used-1'],
      requiredCategoryGroups: [
        ['VEGETARIAN', 'VEGAN'],
        ['GLUTEN_FREE'],
        ['DAIRY_FREE'],
      ],
      desiredTotal: 1,
    });
  });

  const insufficientProfiles: Array<[unknown, string]> = [
    [null, 'missing profile'],
    [completeProfile({ diet: Diet.KETO }), 'diet without verifiable metadata'],
    [completeProfile({ excludedIngredients: [DietaryRestriction.NUTS] }), 'ingredient restriction without verifiable metadata'],
    [completeProfile({ excludedIngredients: undefined }), 'incomplete profile'],
  ];

  it.each(insufficientProfiles)('rejects %s as an insufficient profile without querying candidates', async (profile) => {
    mockProfileRepository.findByUserId.mockResolvedValue(profile);

    await expect(service.evaluate({ userId: 'user-1', desiredTotal: 1 })).rejects.toThrow();

    expect(mockRecipeRepository.findCoverageCandidates).not.toHaveBeenCalled();
  });

  it('propagates a technical candidate-query failure instead of converting it to an empty catalog', async () => {
    const databaseError = new Error('database unavailable');
    mockRecipeRepository.findCoverageCandidates.mockRejectedValue(databaseError);

    await expect(service.evaluate({ userId: 'user-1', desiredTotal: 1 })).rejects.toBe(databaseError);
  });

  it('uses deterministic score, match reasons, topic, prep time, and id ordering after defensive id deduplication', async () => {
    mockRecipeRepository.findCoverageCandidates.mockResolvedValue([
      recipe({ id: 'duplicate', title: 'Avena', categories: ['VEGAN'], prepMinutes: 5 }),
      recipe({ id: 'duplicate', title: 'Otra fila', categories: ['VEGAN', 'HIGH_PROTEIN'], prepMinutes: 1 }),
      recipe({ id: 'z-last', title: 'Avena tropical', categories: ['VEGAN'], prepMinutes: 5 }),
      recipe({ id: 'b-middle', title: 'Otro plato', categories: ['VEGAN', 'HIGH_PROTEIN'], prepMinutes: 20 }),
      recipe({ id: 'a-first', title: 'Otro plato', categories: ['VEGAN', 'HIGH_PROTEIN'], prepMinutes: 20 }),
    ]);

    const evaluation = await service.evaluate({
      userId: 'user-1',
      desiredTotal: 4,
      topic: ' avena ',
      categories: ['VEGAN', 'HIGH_PROTEIN'],
      properties: ['sin gluten'],
      maxPrepMinutes: 30,
    });

    expect(evaluation.result.compatibleRecipes.map((item: { recipe: { id: string } }) => item.recipe.id)).toEqual([
      'a-first',
      'b-middle',
      'duplicate',
      'z-last',
    ]);
    expect(evaluation.result.compatibleRecipes.map((item: { score: number }) => item.score)).toEqual([3, 3, 2, 2]);
    expect(evaluation.result.compatibleRecipes[2].matchReasons).toEqual([
      'category:VEGAN',
      'property:sin gluten',
      'topic:title',
      'prep-minutes:5',
    ]);
    expect(evaluation.result.normalizedCriteria).toEqual({
      topic: 'avena',
      categories: ['VEGAN', 'HIGH_PROTEIN'],
      properties: ['sin gluten'],
      maxPrepMinutes: 30,
    });
  });

  it('keeps its in-memory topic ordering aligned with PostgreSQL unaccent expansions before the SQL limit, including Æ matching AE', async () => {
    // The repository has already ordered these candidates by its unaccent(lower(...))
    // topic expression. The service must not undo that semantic order while verifying it.
    mockRecipeRepository.findCoverageCandidates.mockResolvedValue([
      recipe({ id: 'z-unaccent-match', title: 'Æble con canela', prepMinutes: 30 }),
      recipe({ id: 'a-no-match', title: 'Pera con canela', prepMinutes: 5 }),
    ]);

    const evaluation = await service.evaluate({
      userId: 'user-1',
      desiredTotal: 2,
      topic: 'ae',
    });

    expect(evaluation.result.compatibleRecipes.map((item: { recipe: { id: string } }) => item.recipe.id)).toEqual([
      'z-unaccent-match',
      'a-no-match',
    ]);
    expect(evaluation.result.compatibleRecipes[0].matchReasons).toContain('topic:title');
  });

  it('uses the opaque topic-match signal calculated by the bounded database query instead of trying to emulate every unaccent mapping', async () => {
    mockRecipeRepository.findCoverageCandidates.mockResolvedValue([
      // PostgreSQL's unaccent expression already ranked this candidate as a match.
      // Ĳ/IJ is intentionally outside any finite client-side ligature replacement list.
      recipe({ id: 'z-db-match', title: 'Ĳsselmeer sopa', prepMinutes: 30, topic: true }),
      recipe({ id: 'a-db-no-match', title: 'Sopa de pera', prepMinutes: 5, topic: false }),
    ]);

    const evaluation = await service.evaluate({
      userId: 'user-1',
      desiredTotal: 2,
      topic: 'ij',
    });

    expect(evaluation.result.compatibleRecipes.map((item: { recipe: { id: string } }) => item.recipe.id)).toEqual([
      'z-db-match',
      'a-db-no-match',
    ]);
    expect(evaluation.result.compatibleRecipes[0].matchReasons).toContain('topic:catalog');
    expect(evaluation.result.compatibleRecipes[1].matchReasons).not.toContain('topic:catalog');
  });

  it('keeps distinct potential duplicates and emits stable warnings from accent-, case-, punctuation-, and whitespace-insensitive fingerprints', async () => {
    mockRecipeRepository.findCoverageCandidates.mockResolvedValue([
      recipe({
        id: 'recipe-z',
        title: '  CAFÉ, con Leche! ',
        ingredients: [{ name: ' Leche ' }, { name: 'Café' }, { name: 'leche' }],
      }),
      recipe({
        id: 'recipe-a',
        title: 'cafe con leche',
        ingredients: [{ name: 'cafe' }, { name: 'LECHE' }, { unexpected: true }],
      }),
    ]);

    const evaluation = await service.evaluate({ userId: 'user-1', desiredTotal: 2 });

    expect(evaluation.result.compatibleRecipes.map((item: { recipe: { id: string } }) => item.recipe.id)).toEqual(['recipe-a', 'recipe-z']);
    expect(evaluation.warnings).toEqual([
      {
        kind: 'potential-duplicate',
        fingerprint: 'cafe con leche|cafe|leche',
        recipeIds: ['recipe-a', 'recipe-z'],
      },
    ]);
  });
});
