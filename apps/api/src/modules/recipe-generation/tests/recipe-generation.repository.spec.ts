import { ConflictException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { RecipeCategory } from '@/generated/prisma/client';
import { RecipeGenerationRepository } from '../recipe-generation.repository';

const expiresAt = new Date('2099-10-08T12:00:00.000Z');
const previewKey = 'preview-idempotency-key';
const confirmKey = 'confirm-idempotency-key';
const draftOne = '11111111-1111-4111-8111-111111111111';
const draftTwo = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const trackingImage = { url: 'https://images.example.test/recipe.jpg', tracking: { trackingUrl: 'https://tracking.example.test/download' } };

const draft = (draftId: string, title: string) => ({
  draftId,
  recipe: {
    title, description: `${title} description`, prepMinutes: 10, cookMinutes: 15,
    ingredients: [{ name: 'Tomato', quantity: 1, unit: 'unit' }], instructions: ['Cook it'],
    categories: [RecipeCategory.VEGETARIAN], nutritionalValues: { calories: 100, protein: 5 }, properties: ['quick'],
  },
  image: trackingImage,
  warnings: [{ code: 'IMAGE_UNAVAILABLE' as const, message: 'Recipe image is unavailable' }],
});

const readyRun = (overrides: Record<string, unknown> = {}) => ({
  id: runId, userId: 'user-1', kind: 'RECIPE_SINGLE', status: 'READY_FOR_REVIEW', expiresAt,
  requestSnapshot: { description: 'tomato lunch' },
  outputSnapshot: {
    version: 1, requestedCount: 2, reused: [],
    drafts: [draft(draftOne, 'First recipe'), draft(draftTwo, 'Second recipe')],
    rejected: [{ candidateIndex: 2, codes: ['DUPLICATE_RECIPE'] }], confirmation: null,
  },
  ...overrides,
});

const previewInput = () => ({
  userId: 'user-1', kind: 'RECIPE_SINGLE', idempotencyKey: previewKey,
  provider: 'gemini', model: 'test-model', promptVersion: 'recipe-preview-v1', schemaVersion: 'recipe-candidate-v1',
  requestSnapshot: { description: 'tomato lunch' }, profileSnapshot: { diet: 'VEGETARIAN' }, expiresAt,
});

describe('RecipeGenerationRepository durable GenerationRun persistence (NUT-73)', () => {
  const repositoryFile = path.resolve(__dirname, '../recipe-generation.repository.ts');

  it('keeps confirm writes inside a Prisma transaction and has no network-provider dependency', () => {
    expect(fs.existsSync(repositoryFile)).toBe(true);
    const source = fs.readFileSync(repositoryFile, 'utf8');

    expect(source).toMatch(/confirmDraftsTransaction[\s\S]*?\$transaction/);
    expect(source).not.toMatch(/unsplash|gemini|fetch\s*\(|axios|https?:/i);
  });

  it('creates a durable PENDING recipe preview run with a preview-key hash and no raw key', async () => {
    const create = jest.fn().mockResolvedValue({ id: runId, status: 'PENDING' });
    const repository = new RecipeGenerationRepository({ generationRun: { create } } as any);

    await expect(repository.createOrRecoverPreviewRun(previewInput())).resolves.toEqual({ wasCreated: true, run: { id: runId, status: 'PENDING' } });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user-1', kind: 'RECIPE_SINGLE', status: 'PENDING', provider: 'gemini', model: 'test-model',
        promptVersion: 'recipe-preview-v1', schemaVersion: 'recipe-candidate-v1',
        requestSnapshot: { description: 'tomato lunch' }, profileSnapshot: { diet: 'VEGETARIAN' }, expiresAt,
        idempotencyKeyHash: expect.any(String),
      }),
    }));
    expect(create.mock.calls[0][0].data.idempotencyKeyHash).not.toContain(previewKey);
  });

  it('replays the same preview key but rejects that key when its normalized payload conflicts', async () => {
    const existing = readyRun();
    const findFirst = jest.fn().mockResolvedValue(existing);
    const create = jest.fn().mockRejectedValue({ code: 'P2002' });
    const repository = new RecipeGenerationRepository({ generationRun: { create, findFirst } } as any);

    await expect(repository.createOrRecoverPreviewRun(previewInput())).resolves.toEqual({ wasCreated: false, run: existing });
    await expect(repository.createOrRecoverPreviewRun({ ...previewInput(), requestSnapshot: { description: 'different lunch' } }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('expires a recovered READY preview before retrying its same key as a fresh PENDING run', async () => {
    const expired = readyRun({ expiresAt: new Date('2026-10-06T12:00:00.000Z') });
    const create = jest.fn()
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce({ id: 'fresh-run', status: 'PENDING' });
    const findFirst = jest.fn().mockResolvedValue(expired);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const repository = new RecipeGenerationRepository({ generationRun: { create, findFirst, updateMany } } as any);

    await expect(repository.createOrRecoverPreviewRun(previewInput()))
      .resolves.toEqual({ wasCreated: true, run: { id: 'fresh-run', status: 'PENDING' } });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: runId, userId: 'user-1', status: 'READY_FOR_REVIEW' }),
      data: expect.objectContaining({ status: 'EXPIRED' }),
    }));
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('persists stable drafts, their private image and rejected/warning evidence in outputSnapshot without creating a Recipe', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const recipeCreate = jest.fn();
    const repository = new RecipeGenerationRepository({ generationRun: { updateMany }, recipe: { create: recipeCreate } } as any);
    const drafts = [draft(draftOne, 'First recipe'), draft(draftTwo, 'Second recipe')];

    await expect(repository.persistReadyPreview({
      runId, userId: 'user-1', kind: 'RECIPE_SINGLE', reused: [], drafts,
      rejected: [{ candidateIndex: 2, codes: ['DUPLICATE_RECIPE'] }], validationSnapshot: { stage: 'duplicates', codes: ['DUPLICATE_RECIPE'], warnings: [] }, expiresAt,
    })).resolves.toMatchObject({ generationRunId: runId, status: 'READY_FOR_REVIEW', drafts });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: runId, userId: 'user-1', status: 'PENDING' }),
      data: expect.objectContaining({
        status: 'READY_FOR_REVIEW', expiresAt, validationSnapshot: { stage: 'duplicates', codes: ['DUPLICATE_RECIPE'], warnings: [] },
        outputSnapshot: expect.objectContaining({
          version: 1,
          drafts: expect.arrayContaining([expect.objectContaining({ draftId: draftOne, image: trackingImage, warnings: [{ code: 'IMAGE_UNAVAILABLE', message: 'Recipe image is unavailable' }] })]),
          rejected: [{ candidateIndex: 2, codes: ['DUPLICATE_RECIPE'] }], confirmation: null,
        }),
      }),
    }));
    expect(recipeCreate).not.toHaveBeenCalled();
  });

  it('confirms only selected snapshot drafts atomically as AI Recipes linked to the run and preserves their image', async () => {
    const run = readyRun();
    const recipeCreate = jest.fn().mockResolvedValue({ id: 'recipe-1', image: trackingImage });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = { generationRun: { findFirst: jest.fn().mockResolvedValue(run), updateMany }, recipe: { create: recipeCreate } };
    const transaction = jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx));
    const repository = new RecipeGenerationRepository({ $transaction: transaction } as any);

    await expect(repository.confirmDraftsTransaction({ userId: 'user-1', generationRunId: runId, draftIds: [draftTwo], idempotencyKey: confirmKey }))
      .resolves.toMatchObject({ generationRunId: runId, items: [{ id: 'recipe-1', image: trackingImage }] });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(recipeCreate).toHaveBeenCalledTimes(1);
    expect(recipeCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ title: 'Second recipe', origin: 'AI', generationRunId: runId, image: trackingImage }) });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: runId, userId: 'user-1', status: 'READY_FOR_REVIEW' }),
      data: expect.objectContaining({ status: 'CONFIRMED', outputSnapshot: expect.objectContaining({
        confirmation: expect.objectContaining({ selectedDraftIds: [draftTwo], idempotencyKeyHash: expect.any(String) }),
      }) }),
    }));
  });

  it('replays the same confirm key without writes and rejects another key or selected-draft set after confirmation', async () => {
    const response = { generationRunId: runId, items: [{ id: 'recipe-1', image: trackingImage }] };
    const confirmed = readyRun({
      status: 'CONFIRMED',
      outputSnapshot: {
        ...readyRun().outputSnapshot,
        confirmation: {
          idempotencyKeyHash: 'expected-confirm-hash', requestFingerprint: 'expected-request-fingerprint',
          selectedDraftIds: [draftOne], response,
        },
      },
    });
    const recipeCreate = jest.fn();
    const tx = { generationRun: { findFirst: jest.fn().mockResolvedValue(confirmed), updateMany: jest.fn() }, recipe: { create: recipeCreate } };
    const repository = new RecipeGenerationRepository({ $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) } as any);
    const replayInput = { userId: 'user-1', generationRunId: runId, draftIds: [draftOne], idempotencyKey: confirmKey, confirmKeyHash: 'expected-confirm-hash', requestFingerprint: 'expected-request-fingerprint' };

    await expect(repository.confirmDraftsTransaction(replayInput)).resolves.toMatchObject({ replayed: true, ...response });
    expect(recipeCreate).not.toHaveBeenCalled();
    await expect(repository.confirmDraftsTransaction({ ...replayInput, confirmKeyHash: 'other-key-hash' })).rejects.toBeInstanceOf(ConflictException);
    await expect(repository.confirmDraftsTransaction({ ...replayInput, requestFingerprint: 'other-draft-selection' })).rejects.toBeInstanceOf(ConflictException);
  });
});
