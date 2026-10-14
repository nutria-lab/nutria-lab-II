import { RecipeGenerationService } from '../recipe-generation.service';
import { generatedRecipe } from '@/modules/recipe/tests/recipe-validation.fixtures';
import { parseGeneratedOutput } from '@/modules/recipe/validation/parse-generated-output';
import { summarizeParseFailure, summarizeResults, validateRecipe } from '@/modules/recipe/validation/validate-recipe';

const key = '11111111-1111-4111-8111-111111111111';
const userId = 'user-1';
const profile = { goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'STANDARD' };
const jsonRecipes = (recipes: unknown[]) => JSON.stringify({ recipes });

describe('RecipeGenerationService preview with the real NUT-74 validator (NUT-73)', () => {
  let service: RecipeGenerationService;
  let repository: any;
  let coverage: any;
  let provider: any;
  let recipes: any;
  let profiles: any;
  let images: any;

  beforeEach(() => {
    repository = {
      createOrRecoverPreviewRun: jest.fn().mockResolvedValue({ wasCreated: true, run: { id: 'run-1', status: 'PENDING' } }),
      persistReadyPreview: jest.fn().mockImplementation(async (input: any) => ({ generationRunId: input.runId, status: 'READY_FOR_REVIEW', drafts: input.drafts, reused: input.reused })),
      rejectPreview: jest.fn(),
      failPreview: jest.fn(),
    };
    coverage = { evaluate: jest.fn().mockResolvedValue({ profile, result: { compatibleRecipes: [], missingCount: 0 } }) };
    provider = { generate: jest.fn().mockResolvedValue(jsonRecipes([generatedRecipe()])) };
    recipes = { findByNormalizedTitles: jest.fn().mockResolvedValue([]) };
    profiles = { findByUserId: jest.fn().mockResolvedValue(profile) };
    images = { searchAndSelectCandidate: jest.fn().mockResolvedValue(null) };
    service = new RecipeGenerationService(repository, coverage, provider, recipes, profiles, images);
  });

  it('TOTAL_DESIRED with complete coverage reaches review without provider or image I/O and never creates a Recipe', async () => {
    coverage.evaluate.mockResolvedValue({ profile, result: { compatibleRecipes: [{ recipe: { id: 'catalog-1' }, matchReasons: ['category:VEGAN'] }], missingCount: 0 } });

    await service.preview(userId, key, { mode: 'BATCH', countMode: 'TOTAL_DESIRED', count: 1, topic: 'cenas' });

    expect(coverage.evaluate).toHaveBeenCalledWith(expect.objectContaining({ userId, desiredTotal: 1 }));
    expect(provider.generate).not.toHaveBeenCalled();
    expect(images.searchAndSelectCandidate).not.toHaveBeenCalled();
    expect(repository.persistReadyPreview).toHaveBeenCalledWith(expect.objectContaining({ drafts: [] }));
  });

  it('does not turn a recovered PENDING preview reservation into an empty success response', async () => {
    repository.createOrRecoverPreviewRun.mockResolvedValue({ wasCreated: false, run: { id: 'run-1', status: 'PENDING', outputSnapshot: null } });

    await expect(service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'Una cena vegana rápida y completa' }))
      .rejects.toMatchObject({ status: 409 });

    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.persistReadyPreview).not.toHaveBeenCalled();
  });

  it('uses the real NUT-74 parse and validation pipeline to persist its normalized recipe, warnings, and sanitized summary', async () => {
    const rawCandidate = generatedRecipe({ title: '  Ensalada   de quinoa  ', properties: [' Alto en fibra '] });
    const validation = validateRecipe(rawCandidate, { excludedIngredients: [] });
    expect(validation.valid).toBe(true);
    if (!validation.valid) throw new Error('NUT-74 fixture must remain valid');
    provider.generate.mockResolvedValue(jsonRecipes([rawCandidate]));

    await service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'Una cena vegana rápida y completa' });

    expect(recipes.findByNormalizedTitles).toHaveBeenCalledWith(['ensalada de quinoa']);
    expect(repository.persistReadyPreview).toHaveBeenCalledWith(expect.objectContaining({
      drafts: [expect.objectContaining({ recipe: validation.normalizedRecipe, warnings: validation.warnings })],
      validationSnapshot: summarizeResults([validation]),
    }));
    expect(images.searchAndSelectCandidate).toHaveBeenCalledWith(validation.normalizedRecipe.title);
  });

  it('NEW_ONLY requests exactly count from the provider and never fills preview drafts from catalog coverage', async () => {
    const candidates = [generatedRecipe(), generatedRecipe({ title: 'Ensalada de lentejas' }), generatedRecipe({ title: 'Tofu salteado' })];
    provider.generate.mockResolvedValue(jsonRecipes(candidates));

    await service.preview(userId, key, { mode: 'BATCH', countMode: 'NEW_ONLY', count: 3, topic: 'cenas' });

    expect(coverage.evaluate).not.toHaveBeenCalled();
    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({ count: 3 }));
  });

  it('records NUT-74 excluded-ingredient codes and summary, returns 422, and never resolves an image or persists a draft', async () => {
    const rawCandidate = generatedRecipe({ title: 'Pasta con maní', ingredients: [{ name: 'Maní', quantity: 100, unit: 'g' }] });
    const validation = validateRecipe(rawCandidate, { excludedIngredients: ['nuts'] });
    expect(validation.valid).toBe(false);
    if (validation.valid) throw new Error('NUT-74 fixture must be rejected for its excluded ingredient');
    profiles.findByUserId.mockResolvedValue({ ...profile, excludedIngredients: ['NUTS'] });
    provider.generate.mockResolvedValue(jsonRecipes([rawCandidate]));

    await expect(service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'Una cena vegana rápida y completa' }))
      .rejects.toMatchObject({ status: 422 });

    expect(images.searchAndSelectCandidate).not.toHaveBeenCalled();
    expect(repository.persistReadyPreview).not.toHaveBeenCalled();
    expect(repository.rejectPreview).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1', userId,
      rejected: [expect.objectContaining({ candidateIndex: 0, codes: ['EXCLUDED_INGREDIENT'] })],
      validationSnapshot: summarizeResults([validation]),
    }));
  });

  it('does not retry or resolve an image when NUT-74 rejects an invalid category/range candidate', async () => {
    provider.generate.mockResolvedValue(jsonRecipes([generatedRecipe({ prepMinutes: 0, categories: ['NOT_A_CATEGORY'] })]));

    await expect(service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'Una cena vegana rápida y completa' }))
      .rejects.toMatchObject({ status: 422 });

    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(images.searchAndSelectCandidate).not.toHaveBeenCalled();
  });

  it('records a sanitized NUT-74 parse failure for malformed structured provider output without an image request', async () => {
    const rawOutput = 'Esta respuesta no es JSON estructurado';
    const parsed = parseGeneratedOutput(rawOutput, 1);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('NUT-74 fixture must be malformed structured output');
    provider.generate.mockResolvedValue(rawOutput);

    await expect(service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'Una cena vegana rápida y completa' }))
      .rejects.toMatchObject({ status: 422 });

    expect(images.searchAndSelectCandidate).not.toHaveBeenCalled();
    expect(repository.rejectPreview).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1', userId,
      rejected: [{ candidateIndex: null, codes: ['INVALID_JSON'], errors: expect.any(Array) }],
      validationSnapshot: summarizeParseFailure(parsed.errors),
    }));
  });

  it('maps provider rate-limit and timeout failures without persisting drafts', async () => {
    provider.generate.mockRejectedValueOnce(Object.assign(new Error('provider limited'), { code: 'RATE_LIMITED' }));
    await expect(service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'Una cena vegana rápida y completa' }))
      .rejects.toMatchObject({ status: 429 });
    expect(repository.failPreview).toHaveBeenCalledWith(expect.objectContaining({ code: 'RATE_LIMITED' }));

    repository.createOrRecoverPreviewRun.mockResolvedValue({ wasCreated: true, run: { id: 'run-2', status: 'PENDING' } });
    provider.generate.mockRejectedValueOnce(Object.assign(new Error('provider timeout'), { code: 'TIMEOUT' }));
    await expect(service.preview(userId, '22222222-2222-4222-8222-222222222222', { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'Una cena vegana rápida y completa' }))
      .rejects.toMatchObject({ status: 503 });
    expect(repository.persistReadyPreview).not.toHaveBeenCalled();
  });

  it('keeps image lookup optional and bounded to three concurrent requests for NUT-74 accepted drafts', async () => {
    const candidates = Array.from({ length: 10 }, (_, index) => generatedRecipe({ title: `Receta válida ${index}` }));
    provider.generate.mockResolvedValue(jsonRecipes(candidates));
    let inFlight = 0;
    let peak = 0;
    images.searchAndSelectCandidate.mockImplementation(async (title: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      if (title.endsWith('4')) throw new Error('image lookup unavailable');
      return { url: `https://images.example/${title}`, alt: title };
    });

    const result = await service.preview(userId, key, { mode: 'BATCH', countMode: 'NEW_ONLY', count: 10, topic: 'cenas' });

    expect(peak).toBeLessThanOrEqual(3);
    expect(result.drafts).toHaveLength(10);
    expect(result.drafts[4].image).toBeNull();
  });
});
