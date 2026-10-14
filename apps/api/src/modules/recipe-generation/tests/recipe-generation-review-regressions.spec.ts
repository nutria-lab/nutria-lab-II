import { ConfigModule } from '@nestjs/config';
import { ConflictException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RecipeGenerationModule } from '../recipe-generation.module';
import { RecipeGenerationService } from '../recipe-generation.service';
import { RECIPE_GENERATION_PROVIDER } from '../recipe-generation.ports';
import { RecipeGenerationRepository } from '../recipe-generation.repository';
import { generatedRecipe } from '@/modules/recipe/tests/recipe-validation.fixtures';

const userId = 'review-user';
const key = '11111111-1111-4111-8111-111111111111';
const future = new Date('2099-10-08T12:00:00.000Z');
const expired = new Date('2026-10-06T12:00:00.000Z');
const rawRecipes = (recipes: unknown[]) => JSON.stringify({ recipes });

function makeService(profile: Record<string, unknown>) {
  const repository = {
    createOrRecoverPreviewRun: jest.fn().mockResolvedValue({ wasCreated: true, run: { id: 'run-1', status: 'PENDING' } }),
    persistReadyPreview: jest.fn().mockImplementation(async (input: any) => ({ generationRunId: input.runId, status: 'READY_FOR_REVIEW', drafts: input.drafts, reused: input.reused })),
    rejectPreview: jest.fn(),
    failPreview: jest.fn(),
    confirmDraftsTransaction: jest.fn(),
    findRunForOwner: jest.fn().mockResolvedValue({ id: 'run-1', userId, status: 'READY_FOR_REVIEW' }),
    findRunById: jest.fn(),
    selectedDrafts: jest.fn(),
  };
  const coverage = { evaluate: jest.fn() };
  const provider = { generate: jest.fn().mockResolvedValue(rawRecipes([generatedRecipe()])) };
  const recipes = { findByNormalizedTitles: jest.fn().mockResolvedValue([]) };
  const profiles = { findByUserId: jest.fn().mockResolvedValue(profile) };
  const images = { searchAndSelectCandidate: jest.fn().mockResolvedValue(null), trackDownload: jest.fn() };
  return { service: new RecipeGenerationService(repository as any, coverage as any, provider, recipes as any, profiles as any, images as any), repository, coverage, provider, recipes, profiles, images };
}

describe('NUT-73 PR #52 review regressions', () => {
  it('boots the real RecipeGenerationModule and binds the generation port to the concrete Gemini adapter', async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ JWT_SECRET: 'test', GEMINI_API_KEY: 'test-key' })] }), RecipeGenerationModule],
    }).compile();

    expect(module.get(RecipeGenerationService)).toBeInstanceOf(RecipeGenerationService);
    const provider = module.get(RECIPE_GENERATION_PROVIDER);
    expect(provider.constructor.name).toBe('GeminiRecipeGenerationProvider');
  });

  it('uses the Gemini adapter for structured success, provider failure, and timeout without making a real request', async () => {
    const generateContent = jest.fn();
    jest.doMock('@google/generative-ai', () => ({ GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: jest.fn(() => ({ generateContent })) })) }));
    let GeminiRecipeGenerationProvider: any;
    jest.isolateModules(() => ({ GeminiRecipeGenerationProvider } = require('../recipe-generation.ports')));
    const adapter = new GeminiRecipeGenerationProvider({ get: jest.fn().mockReturnValue('test-key') });
    const input = { profile: { diet: 'VEGAN' }, criteria: { topic: 'cena' }, count: 1, promptVersion: 'recipe-preview-v1', schemaVersion: 'recipe-candidate-v1' };

    generateContent.mockResolvedValueOnce({ response: { text: () => rawRecipes([generatedRecipe()]) } });
    await expect(adapter.generate(input)).resolves.toBe(rawRecipes([generatedRecipe()]));

    generateContent.mockRejectedValueOnce(new Error('Gemini unavailable'));
    await expect(adapter.generate(input)).rejects.toMatchObject({ name: 'AiProviderUnavailableError', reason: 'AI_PROVIDER_ERROR' });

    jest.useFakeTimers();
    generateContent.mockImplementationOnce((_request: unknown, options: { signal: AbortSignal }) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const timedOut = adapter.generate(input);
    await jest.advanceTimersByTimeAsync(90_000);
    await expect(timedOut).rejects.toMatchObject({ name: 'AiProviderUnavailableError', reason: 'AI_TIMEOUT' });
    jest.useRealTimers();
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it('removes a wheat-containing GLUTEN_FREE catalog recipe, recalculates the missing count, and generates the replacement', async () => {
    const { service, coverage, provider, repository } = makeService({ goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: ['GLUTEN'], cookTimePreference: 'STANDARD' });
    coverage.evaluate.mockResolvedValue({
      profile: { goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: ['GLUTEN'], cookTimePreference: 'STANDARD' },
      result: {
        compatibleRecipes: [{ recipe: { id: 'unsafe-wheat', title: 'Pan de trigo', description: 'Con trigo', ingredients: [{ name: 'Harina de trigo' }], instructions: ['Hornear'], categories: ['GLUTEN_FREE'] } }],
        compatibleCount: 1,
        missingCount: 0,
      },
    });

    await service.preview(userId, key, { mode: 'BATCH', countMode: 'TOTAL_DESIRED', count: 1, topic: 'cenas' } as any);

    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));
    expect(repository.persistReadyPreview).toHaveBeenCalledWith(expect.objectContaining({ reused: [] }));
  });

  it('rejects provider chicken for a VEGAN profile before image lookup or preview persistence', async () => {
    const { service, provider, images, repository } = makeService({ goal: 'MAINTAIN', diet: 'VEGAN', excludedIngredients: [], cookTimePreference: 'STANDARD' });
    provider.generate.mockResolvedValue(rawRecipes([generatedRecipe({ ingredients: [{ name: 'Pollo', quantity: 150, unit: 'g' }], categories: [] })]));

    await expect(service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'cena' } as any))
      .rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(images.searchAndSelectCandidate).not.toHaveBeenCalled();
    expect(repository.persistReadyPreview).not.toHaveBeenCalled();
    expect(repository.rejectPreview).toHaveBeenCalled();
  });

  it('revalidates persisted meat drafts against the current VEGAN profile before confirmation writes', async () => {
    const { service, repository } = makeService({ goal: 'MAINTAIN', diet: 'VEGAN', excludedIngredients: [], cookTimePreference: 'STANDARD' });
    const unsafeDraft = { draftId: 'draft-1', recipe: generatedRecipe({ ingredients: [{ name: 'Carne vacuna', quantity: 150, unit: 'g' }], categories: [] }), image: null, warnings: [] };
    repository.selectedDrafts.mockReturnValue([unsafeDraft]);

    await expect(service.confirm(userId, key, { generationRunId: 'run-1', draftIds: ['draft-1'] } as any))
      .rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(repository.confirmDraftsTransaction).not.toHaveBeenCalled();
  });

  it('expires a stale PENDING reservation atomically and reserves a fresh run for the same preview key', async () => {
    const stale = { id: 'stale-run', userId, kind: 'RECIPE_SINGLE', status: 'PENDING', expiresAt: expired, requestSnapshot: { description: 'cena' } };
    const create = jest.fn().mockRejectedValueOnce({ code: 'P2002' }).mockResolvedValueOnce({ id: 'fresh-run', status: 'PENDING', outputSnapshot: null });
    const findFirst = jest.fn().mockResolvedValue(stale);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const repository = new RecipeGenerationRepository({ generationRun: { create, findFirst, updateMany } } as any);

    await expect(repository.createOrRecoverPreviewRun({ userId, kind: 'RECIPE_SINGLE', idempotencyKey: key, promptVersion: 'recipe-preview-v1', schemaVersion: 'recipe-candidate-v1', requestSnapshot: { description: 'cena' }, expiresAt: future }))
      .resolves.toMatchObject({ wasCreated: true, run: { id: 'fresh-run', status: 'PENDING' } });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'stale-run', userId, status: 'PENDING', expiresAt: expect.objectContaining({ lte: expect.any(Date) }) }),
      data: expect.objectContaining({ status: 'EXPIRED' }),
    }));
  });

  it('returns a controlled conflict for an active PENDING reservation without a second provider call', async () => {
    const { service, repository, provider } = makeService({ goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'STANDARD' });
    repository.createOrRecoverPreviewRun.mockResolvedValue({ wasCreated: false, run: { id: 'run-1', status: 'PENDING', outputSnapshot: null } });

    await expect(service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'cena' } as any)).rejects.toBeInstanceOf(ConflictException);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('marks a reservation FAILED when an unexpected post-reservation catalog error occurs', async () => {
    const { service, provider, recipes, repository } = makeService({ goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'STANDARD' });
    provider.generate.mockResolvedValue(rawRecipes([generatedRecipe()]));
    recipes.findByNormalizedTitles.mockRejectedValue(new Error('catalog unavailable'));

    await expect(service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'cena' } as any))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repository.failPreview).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1', userId, code: 'TRANSIENT' }));
  });

  it('preserves a post-reservation domain validation status instead of mapping it to 503', async () => {
    const { service, profiles } = makeService({ goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'STANDARD' });
    profiles.findByUserId.mockRejectedValue(new UnprocessableEntityException('profile is invalid'));

    await expect(service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'cena' } as any))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('terminally rejects a post-reservation catalog HttpException before preserving its 422 status', async () => {
    const { service, provider, recipes, repository } = makeService({ goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'STANDARD' });
    provider.generate.mockResolvedValue(rawRecipes([generatedRecipe()]));
    recipes.findByNormalizedTitles.mockRejectedValue(new UnprocessableEntityException('catalog validation failed'));

    await expect(service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'cena' } as any))
      .rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(repository.rejectPreview).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1', userId }));
    expect(repository.failPreview).not.toHaveBeenCalled();
  });

  it.each(['KETO', 'PALEO'])('fails closed for unsupported %s policy in preview without image I/O or preview persistence', async diet => {
    const { service, images, repository } = makeService({ goal: 'MAINTAIN', diet, excludedIngredients: [], cookTimePreference: 'STANDARD' });

    await expect(service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'cena' } as any))
      .rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(images.searchAndSelectCandidate).not.toHaveBeenCalled();
    expect(repository.persistReadyPreview).not.toHaveBeenCalled();
  });

  it.each(['KETO', 'PALEO'])('fails closed for unsupported %s policy in confirmation before persistence', async diet => {
    const { service, repository } = makeService({ goal: 'MAINTAIN', diet, excludedIngredients: [], cookTimePreference: 'STANDARD' });
    repository.selectedDrafts.mockReturnValue([{ draftId: 'draft-1', recipe: generatedRecipe(), image: null, warnings: [] }]);

    await expect(service.confirm(userId, key, { generationRunId: 'run-1', draftIds: ['draft-1'] } as any))
      .rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(repository.confirmDraftsTransaction).not.toHaveBeenCalled();
  });

  it('on a lost conditional expiry update, rereads a ready winner and returns its normal replay state', async () => {
    const stale = { id: 'stale-run', userId, kind: 'RECIPE_SINGLE', status: 'READY_FOR_REVIEW', expiresAt: expired, requestSnapshot: { description: 'cena' } };
    const winner = { id: 'winner-run', userId, kind: 'RECIPE_SINGLE', status: 'READY_FOR_REVIEW', expiresAt: future, requestSnapshot: { description: 'cena' }, outputSnapshot: { version: 1 } };
    const create = jest.fn().mockRejectedValue({ code: 'P2002' });
    const findFirst = jest.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(winner);
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const repository = new RecipeGenerationRepository({ generationRun: { create, findFirst, updateMany } } as any);

    await expect(repository.createOrRecoverPreviewRun({ userId, kind: 'RECIPE_SINGLE', idempotencyKey: key, promptVersion: 'recipe-preview-v1', schemaVersion: 'recipe-candidate-v1', requestSnapshot: { description: 'cena' }, expiresAt: future }))
      .resolves.toMatchObject({ wasCreated: false, run: winner });

    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('on a lost conditional expiry update, rereads an active PENDING winner for the caller to return its controlled conflict', async () => {
    const stale = { id: 'stale-run', userId, kind: 'RECIPE_SINGLE', status: 'READY_FOR_REVIEW', expiresAt: expired, requestSnapshot: { description: 'cena' } };
    const activeWinner = { id: 'winner-run', userId, kind: 'RECIPE_SINGLE', status: 'PENDING', expiresAt: future, requestSnapshot: { description: 'cena' }, outputSnapshot: null };
    const create = jest.fn().mockRejectedValue({ code: 'P2002' });
    const findFirst = jest.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(activeWinner);
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const repository = new RecipeGenerationRepository({ generationRun: { create, findFirst, updateMany } } as any);

    await expect(repository.createOrRecoverPreviewRun({ userId, kind: 'RECIPE_SINGLE', idempotencyKey: key, promptVersion: 'recipe-preview-v1', schemaVersion: 'recipe-candidate-v1', requestSnapshot: { description: 'cena' }, expiresAt: future }))
      .resolves.toMatchObject({ wasCreated: false, run: activeWinner });

    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('fails closed when NEW_ONLY has no persisted profile, before calling the provider or persisting a preview', async () => {
    const { service, profiles, provider, images, repository } = makeService({ goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'STANDARD' });
    profiles.findByUserId.mockResolvedValue(null);

    await expect(service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'cena' } as any))
      .rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(provider.generate).not.toHaveBeenCalled();
    expect(images.searchAndSelectCandidate).not.toHaveBeenCalled();
    expect(repository.persistReadyPreview).not.toHaveBeenCalled();
  });

  it('fails closed when confirmation has no persisted profile, before recipe persistence', async () => {
    const { service, profiles, repository } = makeService({ goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'STANDARD' });
    profiles.findByUserId.mockResolvedValue(null);
    repository.selectedDrafts.mockReturnValue([{ draftId: 'draft-1', recipe: generatedRecipe(), image: null, warnings: [] }]);

    await expect(service.confirm(userId, key, { generationRunId: 'run-1', draftIds: ['draft-1'] } as any))
      .rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(repository.confirmDraftsTransaction).not.toHaveBeenCalled();
  });

  it('sends Gemini a versioned exact recipe-array schema with every required recipe field', async () => {
    const generateContent = jest.fn().mockResolvedValue({ response: { text: () => rawRecipes([generatedRecipe()]) } });
    const getGenerativeModel = jest.fn((_config: unknown) => ({ generateContent }));
    jest.doMock('@google/generative-ai', () => ({ GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel })) }));
    let GeminiRecipeGenerationProvider: any;
    jest.isolateModules(() => ({ GeminiRecipeGenerationProvider } = require('../recipe-generation.ports')));
    const adapter = new GeminiRecipeGenerationProvider({ get: jest.fn().mockReturnValue('test-key') });

    await adapter.generate({ profile: { diet: 'ALL' }, criteria: { topic: 'cena' }, count: 1, promptVersion: 'recipe-preview-v1', schemaVersion: 'recipe-candidate-v1' });

    const modelInput = getGenerativeModel.mock.calls[0]?.[0] as any;
    expect(modelInput.generationConfig).toEqual(expect.objectContaining({
      responseMimeType: 'application/json',
      responseSchema: expect.objectContaining({
        type: expect.anything(),
        required: ['recipes'],
        properties: expect.objectContaining({
          recipes: expect.objectContaining({
            type: expect.anything(),
            items: expect.objectContaining({
              required: expect.arrayContaining(['title', 'description', 'prepMinutes', 'cookMinutes', 'ingredients', 'instructions', 'categories', 'nutritionalValues', 'properties']),
            }),
          }),
        }),
      }),
    }));
    const prompt = JSON.parse(generateContent.mock.calls[0][0].contents[0].parts[0].text);
    expect(prompt).toEqual(expect.objectContaining({
      promptVersion: 'recipe-preview-v1', schemaVersion: 'recipe-candidate-v1',
      outputContract: expect.objectContaining({ version: 'recipe-candidate-v1', required: ['recipes'] }),
    }));
  });

  it('maps a mocked Gemini 429 through RATE_LIMITED to the preview 429 contract, not 503', async () => {
    const generateContent = jest.fn().mockRejectedValue({ status: 429, message: 'quota exhausted' });
    const getGenerativeModel = jest.fn((_config: unknown) => ({ generateContent }));
    jest.doMock('@google/generative-ai', () => ({ GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel })) }));
    let GeminiRecipeGenerationProvider: any;
    jest.isolateModules(() => ({ GeminiRecipeGenerationProvider } = require('../recipe-generation.ports')));
    const adapter = new GeminiRecipeGenerationProvider({ get: jest.fn().mockReturnValue('test-key') });
    const { service, repository } = makeService({ goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'STANDARD' });
    (service as any).provider = adapter;

    await expect(service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'cena' } as any))
      .rejects.toMatchObject({ status: 429 });

    expect(repository.failPreview).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1', userId, code: 'RATE_LIMITED' }));
  });
});
