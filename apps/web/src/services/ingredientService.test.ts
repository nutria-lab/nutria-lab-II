import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from './apiClient';
import {
  ingredientService,
  IngredientRequestError,
  type CreateIngredientRequest,
  type Ingredient,
} from './ingredientService';

// NUT-20 (primera iteración, tester) — `ingredientService` todavía NO EXISTE. Mismo patrón
// que `recipeService.test.ts`: cliente HTTP común sin `skipAuthErrorHandling` (design.md
// 1.4), clase de error propia con `kind` (design.md 1.3, patrón de `registerService.ts`).
// Se espera ROJO hoy, mayormente por módulo inexistente.

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

function buildIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'ingredient-1',
    name: 'Quinoa',
    description: 'Cereal andino sin gluten',
    type: 'GRAIN',
    defaultUnit: 'g',
    nutritionalValues: { calories: 120, protein: 4, carbs: 21, fat: 2, fiber: 3 },
    properties: ['sin gluten'],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildCreatePayload(overrides: Partial<CreateIngredientRequest> = {}): CreateIngredientRequest {
  return {
    name: 'Quinoa',
    description: 'Cereal andino sin gluten',
    type: 'GRAIN',
    defaultUnit: 'g',
    nutritionalValues: { calories: 120, protein: 4, carbs: 21, fat: 2 },
    properties: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ingredientService.list', () => {
  it('GETs /ingredients and returns the collection exactly as the backend sends it', async () => {
    const ingredients = [buildIngredient(), buildIngredient({ id: 'ingredient-2', description: null, defaultUnit: null })];
    vi.mocked(apiClient.get).mockResolvedValue({ data: ingredients });

    const result = await ingredientService.list();

    expect(result).toEqual(ingredients);
    expect(apiClient.get).toHaveBeenCalledWith(
      '/ingredients',
      expect.objectContaining({
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
    const config = vi.mocked(apiClient.get).mock.calls[0]?.[1] as { skipAuthErrorHandling?: boolean } | undefined;
    expect(config?.skipAuthErrorHandling).toBeUndefined();
  });

  it('returns an empty array as-is when the catalog has no ingredients yet (not an error)', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });

    await expect(ingredientService.list()).resolves.toEqual([]);
  });

  it('forwards a caller-provided AbortSignal instead of only creating its own default', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    const controller = new AbortController();

    await ingredientService.list(controller.signal);

    const config = vi.mocked(apiClient.get).mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined;
    expect(config?.signal).toBe(controller.signal);
  });

  it('propagates a 401 like any other rejected request, unwrapped (the global apiClient interceptor already handled it)', async () => {
    const unauthorizedError = httpFailure(401);
    vi.mocked(apiClient.get).mockRejectedValue(unauthorizedError);

    await expect(ingredientService.list()).rejects.toBe(unauthorizedError);
  });
});

describe('ingredientService.getById', () => {
  it('GETs /ingredients/:id and returns the ingredient exactly as the backend sends it', async () => {
    const ingredient = buildIngredient();
    vi.mocked(apiClient.get).mockResolvedValue({ data: ingredient });

    await expect(ingredientService.getById('ingredient-1')).resolves.toEqual(ingredient);
    expect(apiClient.get).toHaveBeenCalledWith(
      '/ingredients/ingredient-1',
      expect.objectContaining({
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
    const config = vi.mocked(apiClient.get).mock.calls[0]?.[1] as { skipAuthErrorHandling?: boolean } | undefined;
    expect(config?.skipAuthErrorHandling).toBeUndefined();
  });

  it('tolerates description: null and defaultUnit: null (historical ingredient data) without transforming them', async () => {
    const ingredient = buildIngredient({ description: null, defaultUnit: null });
    vi.mocked(apiClient.get).mockResolvedValue({ data: ingredient });

    await expect(ingredientService.getById('ingredient-1')).resolves.toEqual(ingredient);
  });

  it('throws IngredientRequestError with kind "notFound" on a 404', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(httpFailure(404));

    await expect(ingredientService.getById('missing')).rejects.toBeInstanceOf(IngredientRequestError);
    await expect(ingredientService.getById('missing')).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('propagates a 401 unwrapped, without a special kind', async () => {
    const unauthorizedError = httpFailure(401);
    vi.mocked(apiClient.get).mockRejectedValue(unauthorizedError);

    await expect(ingredientService.getById('ingredient-1')).rejects.toBe(unauthorizedError);
  });
});

describe('ingredientService.create', () => {
  it('POSTs /ingredients with the exact payload and returns the created ingredient', async () => {
    const payload = buildCreatePayload();
    const created = buildIngredient();
    vi.mocked(apiClient.post).mockResolvedValue({ data: created });

    await expect(ingredientService.create(payload)).resolves.toEqual(created);
    expect(apiClient.post).toHaveBeenCalledWith(
      '/ingredients',
      payload,
      expect.objectContaining({
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
    const config = vi.mocked(apiClient.post).mock.calls[0]?.[2] as { skipAuthErrorHandling?: boolean } | undefined;
    expect(config?.skipAuthErrorHandling).toBeUndefined();
  });

  it('throws IngredientRequestError with kind "conflict" on a 409 (duplicate ingredient name)', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(httpFailure(409));

    await expect(ingredientService.create(buildCreatePayload())).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('throws IngredientRequestError with kind "validation" on a 400', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(httpFailure(400));

    await expect(ingredientService.create(buildCreatePayload())).rejects.toMatchObject({ kind: 'validation' });
  });

  it('normalizes Axios ECONNABORTED as kind "timeout"', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new AxiosError('timeout', 'ECONNABORTED', requestConfig));

    await expect(ingredientService.create(buildCreatePayload())).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('normalizes an Axios cancellation as kind "network", distinct from "timeout"', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new AxiosError('canceled', AxiosError.ERR_CANCELED, requestConfig),
    );

    await expect(ingredientService.create(buildCreatePayload())).rejects.toMatchObject({ kind: 'network' });
  });

  it('normalizes an Axios failure without a response as kind "network"', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new AxiosError('Network Error', AxiosError.ERR_NETWORK, requestConfig),
    );

    await expect(ingredientService.create(buildCreatePayload())).rejects.toMatchObject({ kind: 'network' });
  });

  it('normalizes a non-Axios failure as kind "unexpected"', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('boom'));

    await expect(ingredientService.create(buildCreatePayload())).rejects.toMatchObject({ kind: 'unexpected' });
  });

  it('propagates a 401 unwrapped, without a special kind', async () => {
    const unauthorizedError = httpFailure(401);
    vi.mocked(apiClient.post).mockRejectedValue(unauthorizedError);

    await expect(ingredientService.create(buildCreatePayload())).rejects.toBe(unauthorizedError);
  });
});

describe('ingredientService.update', () => {
  it('PATCHes /ingredients/:id with the given payload and returns the updated ingredient', async () => {
    const payload = { name: 'Quinoa real' };
    const updated = buildIngredient({ name: 'Quinoa real' });
    vi.mocked(apiClient.patch).mockResolvedValue({ data: updated });

    await expect(ingredientService.update('ingredient-1', payload)).resolves.toEqual(updated);
    expect(apiClient.patch).toHaveBeenCalledWith(
      '/ingredients/ingredient-1',
      payload,
      expect.objectContaining({
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
    const config = vi.mocked(apiClient.patch).mock.calls[0]?.[2] as { skipAuthErrorHandling?: boolean } | undefined;
    expect(config?.skipAuthErrorHandling).toBeUndefined();
  });

  it('throws IngredientRequestError with kind "notFound" on a 404', async () => {
    vi.mocked(apiClient.patch).mockRejectedValue(httpFailure(404));

    await expect(ingredientService.update('missing', { name: 'x' })).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('throws IngredientRequestError with kind "conflict" when renaming to a name already in use', async () => {
    vi.mocked(apiClient.patch).mockRejectedValue(httpFailure(409));

    await expect(ingredientService.update('ingredient-1', { name: 'ya existe' })).rejects.toMatchObject({
      kind: 'conflict',
    });
  });

  it('propagates a 401 unwrapped, without a special kind', async () => {
    const unauthorizedError = httpFailure(401);
    vi.mocked(apiClient.patch).mockRejectedValue(unauthorizedError);

    await expect(ingredientService.update('ingredient-1', { name: 'x' })).rejects.toBe(unauthorizedError);
  });
});

describe('ingredientService.remove', () => {
  it('DELETEs /ingredients/:id and resolves to void, regardless of what the backend body contains', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ data: buildIngredient() });

    await expect(ingredientService.remove('ingredient-1')).resolves.toBeUndefined();
    expect(apiClient.delete).toHaveBeenCalledWith(
      '/ingredients/ingredient-1',
      expect.objectContaining({
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
    const config = vi.mocked(apiClient.delete).mock.calls[0]?.[1] as { skipAuthErrorHandling?: boolean } | undefined;
    expect(config?.skipAuthErrorHandling).toBeUndefined();
  });

  it('throws IngredientRequestError with kind "notFound" on a 404', async () => {
    vi.mocked(apiClient.delete).mockRejectedValue(httpFailure(404));

    await expect(ingredientService.remove('missing')).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('throws IngredientRequestError with kind "conflict" when the ingredient is in use by a recipe', async () => {
    vi.mocked(apiClient.delete).mockRejectedValue(httpFailure(409));

    await expect(ingredientService.remove('ingredient-1')).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('propagates a 401 unwrapped, without a special kind', async () => {
    const unauthorizedError = httpFailure(401);
    vi.mocked(apiClient.delete).mockRejectedValue(unauthorizedError);

    await expect(ingredientService.remove('ingredient-1')).rejects.toBe(unauthorizedError);
  });
});
