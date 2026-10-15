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
  it('boots the real RecipeGenerationModule and binds the generation port to OpenAI', async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ JWT_SECRET: 'test', OPENAI_API_KEY: 'test-key' })] }), RecipeGenerationModule],
    }).compile();

    expect(module.get(RecipeGenerationService)).toBeInstanceOf(RecipeGenerationService);
    expect(module.get(RECIPE_GENERATION_PROVIDER).constructor.name).toBe('OpenAIRecipeGenerationProvider');
  });

  it('passes the preview contract to the shared OpenAI service', async () => {
    const openai = { generateJson: jest.fn().mockResolvedValue(rawRecipes([generatedRecipe()])) };
    const { OpenAIRecipeGenerationProvider } = require('../recipe-generation.ports');
    const adapter = new OpenAIRecipeGenerationProvider(openai);
    const input = { profile: { diet: 'VEGAN' }, criteria: { topic: 'cena' }, count: 1, promptVersion: 'recipe-preview-openai-v1', schemaVersion: 'recipe-candidate-openai-v1' };

    await expect(adapter.generate(input)).resolves.toBe(rawRecipes([generatedRecipe()]));
    expect(openai.generateJson).toHaveBeenCalledWith(expect.stringContaining('recipe-preview-openai-v1'), expect.objectContaining({ type: 'object' }), 'recipe_candidates', undefined);
  });

  it('reuses catalog coverage without filtering it by excluded ingredients', async () => {
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

    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.persistReadyPreview).toHaveBeenCalledWith(expect.objectContaining({
      reused: expect.arrayContaining([expect.objectContaining({ recipe: expect.objectContaining({ id: 'unsafe-wheat' }) })]),
      drafts: [],
    }));
  });

  it('accepts a recipe that conflicts with the diet profile and still sends the profile to the model', async () => {
    const { service, provider, images, repository } = makeService({ goal: 'MAINTAIN', diet: 'VEGAN', excludedIngredients: [], cookTimePreference: 'STANDARD' });
    provider.generate.mockResolvedValue(rawRecipes([generatedRecipe({ ingredients: [{ name: 'Pollo', quantity: 150, unit: 'g' }], categories: [] })]));

    await service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'cena' } as any);

    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({ profile: expect.objectContaining({ diet: 'VEGAN' }) }), expect.any(Function));
    expect(images.searchAndSelectCandidate).toHaveBeenCalled();
    expect(repository.persistReadyPreview).toHaveBeenCalled();
    expect(repository.rejectPreview).not.toHaveBeenCalled();
  });

  it('allows confirmation of a persisted recipe that conflicts with the current diet profile', async () => {
    const { service, repository } = makeService({ goal: 'MAINTAIN', diet: 'VEGAN', excludedIngredients: [], cookTimePreference: 'STANDARD' });
    const unsafeDraft = { draftId: 'draft-1', recipe: generatedRecipe({ ingredients: [{ name: 'Carne vacuna', quantity: 150, unit: 'g' }], categories: [] }), image: null, warnings: [] };
    repository.findRunForOwner.mockResolvedValue({ id: 'run-1', userId, status: 'READY_FOR_REVIEW', outputSnapshot: {} });
    repository.selectedDrafts.mockReturnValue([unsafeDraft]);
    repository.confirmDraftsTransaction.mockResolvedValue({ replayed: false, generationRunId: 'run-1', items: [] });

    await service.confirm(userId, key, { generationRunId: 'run-1', draftIds: ['draft-1'] } as any);

    expect(repository.confirmDraftsTransaction).toHaveBeenCalled();
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

  it.each(['KETO', 'PALEO'])('passes %s diet to the model without a server-side policy gate', async diet => {
    const { service, provider, repository } = makeService({ goal: 'MAINTAIN', diet, excludedIngredients: [], cookTimePreference: 'STANDARD' });

    await service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'cena' } as any);

    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({ profile: expect.objectContaining({ diet }) }), expect.any(Function));
    expect(repository.persistReadyPreview).toHaveBeenCalled();
  });

  it.each(['KETO', 'PALEO'])('allows confirmation for a %s profile without a server-side policy gate', async diet => {
    const { service, repository } = makeService({ goal: 'MAINTAIN', diet, excludedIngredients: [], cookTimePreference: 'STANDARD' });
    repository.selectedDrafts.mockReturnValue([{ draftId: 'draft-1', recipe: generatedRecipe(), image: null, warnings: [] }]);
    repository.findRunForOwner.mockResolvedValue({ id: 'run-1', userId, status: 'READY_FOR_REVIEW', outputSnapshot: {} });
    repository.confirmDraftsTransaction.mockResolvedValue({ replayed: false, generationRunId: 'run-1', items: [] });

    await service.confirm(userId, key, { generationRunId: 'run-1', draftIds: ['draft-1'] } as any);

    expect(repository.confirmDraftsTransaction).toHaveBeenCalled();
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

  it('generates with an empty profile snapshot when no persisted profile exists', async () => {
    const { service, profiles, provider, repository } = makeService({ goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'STANDARD' });
    profiles.findByUserId.mockResolvedValue(null);

    await service.preview(userId, key, { mode: 'SINGLE', countMode: 'NEW_ONLY', count: 1, description: 'cena' } as any);

    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({ profile: expect.objectContaining({ excludedIngredients: [] }) }), expect.any(Function));
    expect(repository.persistReadyPreview).toHaveBeenCalled();
  });

  it('allows confirmation when no persisted profile exists', async () => {
    const { service, profiles, repository } = makeService({ goal: 'MAINTAIN', diet: 'ALL', excludedIngredients: [], cookTimePreference: 'STANDARD' });
    profiles.findByUserId.mockResolvedValue(null);
    repository.selectedDrafts.mockReturnValue([{ draftId: 'draft-1', recipe: generatedRecipe(), image: null, warnings: [] }]);
    repository.findRunForOwner.mockResolvedValue({ id: 'run-1', userId, status: 'READY_FOR_REVIEW', outputSnapshot: {} });
    repository.confirmDraftsTransaction.mockResolvedValue({ replayed: false, generationRunId: 'run-1', items: [] });

    await service.confirm(userId, key, { generationRunId: 'run-1', draftIds: ['draft-1'] } as any);

    expect(profiles.findByUserId).toHaveBeenCalledWith(userId);
    expect(repository.confirmDraftsTransaction).toHaveBeenCalled();
  });


});
