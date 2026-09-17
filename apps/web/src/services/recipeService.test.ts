import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from './apiClient';
import {
  recipeService,
  RecipeRequestError,
  type CreateRecipeRequest,
  type Recipe,
} from './recipeService';

// NUT-20 (primera iteración, tester) — `recipeService` todavía NO EXISTE. Este archivo se
// escribe contra el contrato cerrado de NUT-61 documentado en
// `.plans/nut-20-recetas-e-ingredientes/design.md` (sección 3) y siguiendo el patrón ya
// usado por `mealPlanService.ts` (cliente HTTP común, sin `skipAuthErrorHandling` porque la
// sesión ya existe, ver design.md 1.4) y por `registerService.ts` (clase de error propia con
// `kind`, ver design.md 1.3). Se espera ROJO hoy, mayormente por módulo inexistente.

vi.mock('./apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const requestConfig = {
  headers: {},
} as InternalAxiosRequestConfig;

function httpFailure(status: number) {
  return new AxiosError(
    `Request failed with status ${status}`,
    AxiosError.ERR_BAD_RESPONSE,
    requestConfig,
    undefined,
    {
      data: { statusCode: status, message: 'backend detail', error: 'Error' },
      status,
      statusText: 'Error',
      headers: {},
      config: requestConfig,
    },
  );
}

function buildRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'recipe-1',
    title: 'Bowl de quinoa',
    description: 'Bowl fresco con vegetales de estación',
    categories: ['VEGAN', 'GLUTEN_FREE'],
    prepMinutes: 10,
    cookMinutes: 15,
    ingredients: [{ name: 'Quinoa', quantity: 200, unit: 'g' }],
    instructions: ['Cocinar la quinoa', 'Mezclar con los vegetales'],
    nutritionalValues: { calories: 420, protein: 18, carbs: 55, fat: 12 },
    properties: ['sin gluten'],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildCreatePayload(overrides: Partial<CreateRecipeRequest> = {}): CreateRecipeRequest {
  return {
    title: 'Bowl de quinoa',
    description: 'Bowl fresco con vegetales de estación',
    categories: ['VEGAN'],
    prepMinutes: 10,
    cookMinutes: 15,
    ingredients: [{ name: 'Quinoa', quantity: 200, unit: 'g' }],
    instructions: ['Cocinar la quinoa'],
    nutritionalValues: { calories: 420, protein: 18, carbs: 55, fat: 12 },
    properties: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('recipeService.list', () => {
  it('GETs /recipes and returns the collection exactly as the backend sends it, without transforming categories/properties/nutritionalValues', async () => {
    const recipes = [buildRecipe(), buildRecipe({ id: 'recipe-2', nutritionalValues: null })];
    vi.mocked(apiClient.get).mockResolvedValue({ data: recipes });

    const result = await recipeService.list();

    expect(result).toEqual(recipes);
    expect(apiClient.get).toHaveBeenCalledWith(
      '/recipes',
      expect.objectContaining({
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
    const config = vi.mocked(apiClient.get).mock.calls[0]?.[1] as { skipAuthErrorHandling?: boolean } | undefined;
    expect(config?.skipAuthErrorHandling).toBeUndefined();
  });

  it('returns an empty array as-is when the backend has no recipes yet (not an error)', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });

    await expect(recipeService.list()).resolves.toEqual([]);
  });

  it('forwards a caller-provided AbortSignal instead of only creating its own default', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    const controller = new AbortController();

    await recipeService.list(controller.signal);

    const config = vi.mocked(apiClient.get).mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined;
    expect(config?.signal).toBe(controller.signal);
  });

  it('propagates a 401 like any other rejected request, unwrapped (the global apiClient interceptor already handled it)', async () => {
    const unauthorizedError = httpFailure(401);
    vi.mocked(apiClient.get).mockRejectedValue(unauthorizedError);

    await expect(recipeService.list()).rejects.toBe(unauthorizedError);
  });
});

describe('recipeService.getById', () => {
  it('GETs /recipes/:id and returns the recipe exactly as the backend sends it', async () => {
    const recipe = buildRecipe();
    vi.mocked(apiClient.get).mockResolvedValue({ data: recipe });

    await expect(recipeService.getById('recipe-1')).resolves.toEqual(recipe);
    expect(apiClient.get).toHaveBeenCalledWith(
      '/recipes/recipe-1',
      expect.objectContaining({
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
    const config = vi.mocked(apiClient.get).mock.calls[0]?.[1] as { skipAuthErrorHandling?: boolean } | undefined;
    expect(config?.skipAuthErrorHandling).toBeUndefined();
  });

  it('tolerates nutritionalValues: null (historical recipe data) without transforming it', async () => {
    const recipe = buildRecipe({ nutritionalValues: null });
    vi.mocked(apiClient.get).mockResolvedValue({ data: recipe });

    await expect(recipeService.getById('recipe-1')).resolves.toEqual(recipe);
  });

  it('throws RecipeRequestError with kind "notFound" on a 404', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(httpFailure(404));

    await expect(recipeService.getById('missing')).rejects.toBeInstanceOf(RecipeRequestError);
    await expect(recipeService.getById('missing')).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('propagates a 401 unwrapped, without a special kind', async () => {
    const unauthorizedError = httpFailure(401);
    vi.mocked(apiClient.get).mockRejectedValue(unauthorizedError);

    await expect(recipeService.getById('recipe-1')).rejects.toBe(unauthorizedError);
  });
});

describe('recipeService.create', () => {
  it('POSTs /recipes with the exact payload (categories as array, nutritionalValues complete) and returns the created recipe', async () => {
    const payload = buildCreatePayload();
    const created = buildRecipe();
    vi.mocked(apiClient.post).mockResolvedValue({ data: created });

    await expect(recipeService.create(payload)).resolves.toEqual(created);
    expect(apiClient.post).toHaveBeenCalledWith(
      '/recipes',
      payload,
      expect.objectContaining({
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
    const config = vi.mocked(apiClient.post).mock.calls[0]?.[2] as { skipAuthErrorHandling?: boolean } | undefined;
    expect(config?.skipAuthErrorHandling).toBeUndefined();
  });

  it('throws RecipeRequestError with kind "validation" on a 400', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(httpFailure(400));

    await expect(recipeService.create(buildCreatePayload())).rejects.toMatchObject({ kind: 'validation' });
  });

  it('normalizes Axios ECONNABORTED as kind "timeout"', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new AxiosError('timeout', 'ECONNABORTED', requestConfig));

    await expect(recipeService.create(buildCreatePayload())).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('normalizes an Axios cancellation as kind "network", distinct from "timeout"', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new AxiosError('canceled', AxiosError.ERR_CANCELED, requestConfig),
    );

    await expect(recipeService.create(buildCreatePayload())).rejects.toMatchObject({ kind: 'network' });
  });

  it('normalizes an Axios failure without a response as kind "network"', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new AxiosError('Network Error', AxiosError.ERR_NETWORK, requestConfig),
    );

    await expect(recipeService.create(buildCreatePayload())).rejects.toMatchObject({ kind: 'network' });
  });

  it('normalizes a non-Axios failure as kind "unexpected"', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('boom'));

    await expect(recipeService.create(buildCreatePayload())).rejects.toMatchObject({ kind: 'unexpected' });
  });

  it('propagates a 401 unwrapped, without a special kind', async () => {
    const unauthorizedError = httpFailure(401);
    vi.mocked(apiClient.post).mockRejectedValue(unauthorizedError);

    await expect(recipeService.create(buildCreatePayload())).rejects.toBe(unauthorizedError);
  });
});

describe('recipeService.update', () => {
  it('PATCHes /recipes/:id with the given payload and returns the updated recipe', async () => {
    const payload = { title: 'Bowl de quinoa actualizado' };
    const updated = buildRecipe({ title: 'Bowl de quinoa actualizado' });
    vi.mocked(apiClient.patch).mockResolvedValue({ data: updated });

    await expect(recipeService.update('recipe-1', payload)).resolves.toEqual(updated);
    expect(apiClient.patch).toHaveBeenCalledWith(
      '/recipes/recipe-1',
      payload,
      expect.objectContaining({
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
    const config = vi.mocked(apiClient.patch).mock.calls[0]?.[2] as { skipAuthErrorHandling?: boolean } | undefined;
    expect(config?.skipAuthErrorHandling).toBeUndefined();
  });

  it('throws RecipeRequestError with kind "notFound" on a 404', async () => {
    vi.mocked(apiClient.patch).mockRejectedValue(httpFailure(404));

    await expect(recipeService.update('missing', { title: 'x' })).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('throws RecipeRequestError with kind "validation" on a 400', async () => {
    vi.mocked(apiClient.patch).mockRejectedValue(httpFailure(400));

    await expect(recipeService.update('recipe-1', { title: 'x' })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('propagates a 401 unwrapped, without a special kind', async () => {
    const unauthorizedError = httpFailure(401);
    vi.mocked(apiClient.patch).mockRejectedValue(unauthorizedError);

    await expect(recipeService.update('recipe-1', { title: 'x' })).rejects.toBe(unauthorizedError);
  });
});

describe('recipeService.remove', () => {
  it('DELETEs /recipes/:id and resolves to void, regardless of what the backend body contains', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ data: buildRecipe() });

    await expect(recipeService.remove('recipe-1')).resolves.toBeUndefined();
    expect(apiClient.delete).toHaveBeenCalledWith(
      '/recipes/recipe-1',
      expect.objectContaining({
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
    const config = vi.mocked(apiClient.delete).mock.calls[0]?.[1] as { skipAuthErrorHandling?: boolean } | undefined;
    expect(config?.skipAuthErrorHandling).toBeUndefined();
  });

  it('throws RecipeRequestError with kind "notFound" on a 404', async () => {
    vi.mocked(apiClient.delete).mockRejectedValue(httpFailure(404));

    await expect(recipeService.remove('missing')).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('throws RecipeRequestError with kind "conflict" on a 409', async () => {
    vi.mocked(apiClient.delete).mockRejectedValue(httpFailure(409));

    await expect(recipeService.remove('recipe-1')).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('propagates a 401 unwrapped, without a special kind', async () => {
    const unauthorizedError = httpFailure(401);
    vi.mocked(apiClient.delete).mockRejectedValue(unauthorizedError);

    await expect(recipeService.remove('recipe-1')).rejects.toBe(unauthorizedError);
  });
});
