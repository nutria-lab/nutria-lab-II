import { RecipeGenerationService } from '../recipe-generation.service';
import { generatedRecipe } from '@/modules/recipe/tests/recipe-validation.fixtures';
import { validateRecipe } from '@/modules/recipe/validation/validate-recipe';

const key = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const draftId = '33333333-3333-4333-8333-333333333333';

describe('RecipeGenerationService confirmation (NUT-73)', () => {
  let service: RecipeGenerationService;
  let repository: any;
  let provider: any;
  let recipes: any;
  let profiles: any;
  let images: any;
  let selectedDraft: any;

  beforeEach(() => {
    repository = {
      findRunForOwner: jest.fn().mockResolvedValue({ id: runId, userId: 'user-1', status: 'READY_FOR_REVIEW' }),
      findRunById: jest.fn(),
      selectedDrafts: jest.fn(),
      confirmDraftsTransaction: jest.fn(),
    };
    provider = { generate: jest.fn() };
    recipes = { findByNormalizedTitles: jest.fn().mockResolvedValue([]) };
    profiles = { findByUserId: jest.fn().mockResolvedValue({ excludedIngredients: [] }) };
    images = { trackDownload: jest.fn().mockResolvedValue(undefined), searchAndSelectCandidate: jest.fn() };
    const validated = validateRecipe(generatedRecipe(), { excludedIngredients: [] });
    if (!validated.valid) throw new Error('NUT-74 confirmation fixture must be valid');
    selectedDraft = { draftId, recipe: validated.normalizedRecipe, image: { url: 'https://images.example/photo.jpg', alt: 'Bowl', tracking: { downloadLocation: 'private' } }, warnings: validated.warnings };
    repository.selectedDrafts.mockReturnValue([selectedDraft]);
    service = new RecipeGenerationService(repository, { evaluate: jest.fn() }, provider, recipes, profiles, images);
  });

  it('maps a run owned by another user to 403 without exposing drafts or starting a transaction', async () => {
    repository.findRunForOwner.mockResolvedValue(null);
    repository.findRunById.mockResolvedValue({ id: runId, userId: 'other-user' });

    await expect(service.confirm('user-1', key, { generationRunId: runId, draftIds: [draftId] })).rejects.toMatchObject({ status: 403 });

    expect(repository.confirmDraftsTransaction).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
    expect(images.searchAndSelectCandidate).not.toHaveBeenCalled();
  });

  it('persists exactly the selected drafts in one repository transaction, returns only a public image, and tolerates post-commit tracking failure', async () => {
    const persisted = {
      replayed: false,
      generationRunId: runId,
      items: [{ id: 'recipe-1', image: { url: 'https://images.example/photo.jpg', alt: 'Bowl', tracking: { downloadLocation: 'private' } } }],
    };
    repository.confirmDraftsTransaction.mockResolvedValue(persisted);
    images.trackDownload.mockRejectedValue(new Error('tracking unavailable'));

    const result = await service.confirm('user-1', key, { generationRunId: runId, draftIds: [draftId] });

    expect(repository.confirmDraftsTransaction).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', generationRunId: runId, draftIds: [draftId], idempotencyKey: key,
      drafts: [expect.objectContaining({ draftId, recipe: selectedDraft.recipe })],
    }));
    expect(result).toEqual({ generationRunId: runId, items: [{ id: 'recipe-1', image: { url: 'https://images.example/photo.jpg', alt: 'Bowl' } }] });
    expect(images.trackDownload).toHaveBeenCalledTimes(1);
    expect(provider.generate).not.toHaveBeenCalled();
    expect(images.searchAndSelectCandidate).not.toHaveBeenCalled();
  });

  it('refuses confirmation before writes when the persisted draft fails the real NUT-74 validator', async () => {
    const invalid = validateRecipe(generatedRecipe({ categories: ['NOT_A_CATEGORY'] }), { excludedIngredients: [] });
    expect(invalid.valid).toBe(false);
    if (invalid.valid) throw new Error('NUT-74 fixture must be invalid');
    repository.selectedDrafts.mockReturnValue([{ ...selectedDraft, recipe: generatedRecipe({ categories: ['NOT_A_CATEGORY'] }) }]);

    await expect(service.confirm('user-1', key, { generationRunId: runId, draftIds: [draftId] })).rejects.toMatchObject({ status: 422 });

    expect(repository.confirmDraftsTransaction).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
    expect(images.searchAndSelectCandidate).not.toHaveBeenCalled();
  });

  it('replays the same confirmation key without writes, provider calls, image search, or duplicate tracking', async () => {
    repository.confirmDraftsTransaction.mockResolvedValue({ replayed: true, generationRunId: runId, items: [{ id: 'recipe-1', image: null }] });

    await service.confirm('user-1', key, { generationRunId: runId, draftIds: [draftId] });

    expect(images.trackDownload).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
    expect(images.searchAndSelectCandidate).not.toHaveBeenCalled();
  });
});
