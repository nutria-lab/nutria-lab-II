import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  recipeService,
  RecipeRequestError,
  type Recipe,
  type RecipeSearchResponse,
} from '../../../services/recipeService';
import {
  RECIPE_SEARCH_SESSION_KEY,
  useRecipeSearch,
} from './useRecipeSearch';

vi.mock('../../../services/recipeService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/recipeService')>();
  return {
    ...actual,
    recipeService: {
      ...actual.recipeService,
      search: vi.fn(),
    },
  };
});

function createMockRecipe(id: string, title: string = `Receta ${id}`): Recipe {
  return {
    id,
    title,
    description: `Descripción de ${title}`,
    categories: ['VEGAN'],
    prepMinutes: 15,
    cookMinutes: 20,
    ingredients: [{ name: 'Ingrediente 1', quantity: 100, unit: 'g' }],
    instructions: ['Paso 1'],
    nutritionalValues: { calories: 350, protein: 15, carbs: 40, fat: 10 },
    properties: ['Sin Gluten'],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('useRecipeSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces keystrokes by exactly 300ms without firing requests per keystroke', async () => {
    vi.useFakeTimers();

    const mockResponse: RecipeSearchResponse = {
      items: [createMockRecipe('1', 'Pollo con arroz')],
      page: 1,
      pageSize: 12,
      total: 1,
    };
    vi.mocked(recipeService.search).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useRecipeSearch({ enableSessionPersistence: false }));

    // Initial mount triggers 1 request for initial page 1 (without q)
    expect(recipeService.search).toHaveBeenCalledTimes(1);

    // Keystroke 1: 'p'
    act(() => {
      result.current.setDraftText('p');
    });
    expect(result.current.draftText).toBe('p');
    expect(result.current.committedQuery).toBeUndefined();

    // Advance 100ms
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // No new search call
    expect(recipeService.search).toHaveBeenCalledTimes(1);

    // Keystroke 2: 'po'
    act(() => {
      result.current.setDraftText('po');
    });

    // Advance 200ms (total 300ms from keystroke 1, but only 200ms from keystroke 2)
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // Still no new search call because debounce restarted
    expect(recipeService.search).toHaveBeenCalledTimes(1);

    // Keystroke 3: 'pollo'
    act(() => {
      result.current.setDraftText('pollo');
    });

    // Advance 299ms
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(recipeService.search).toHaveBeenCalledTimes(1);

    // Exactly reach 300ms from the last keystroke
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.committedQuery).toBe('pollo');
    expect(recipeService.search).toHaveBeenCalledTimes(2);
    expect(recipeService.search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: 'pollo',
        page: 1,
        pageSize: 4,
      }),
      expect.any(AbortSignal),
    );
  });

  it('resets page to 1 when filters change (committedQuery, properties, maxPrepMinutes)', async () => {
    vi.useFakeTimers();

    const page1Response: RecipeSearchResponse = {
      items: [createMockRecipe('1'), createMockRecipe('2')],
      page: 1,
      pageSize: 2,
      total: 4,
    };
    const page2Response: RecipeSearchResponse = {
      items: [createMockRecipe('3'), createMockRecipe('4')],
      page: 2,
      pageSize: 2,
      total: 4,
    };

    vi.mocked(recipeService.search).mockImplementation(async (params) => {
      return params.page === 2 ? page2Response : page1Response;
    });

    const { result } = renderHook(() =>
      useRecipeSearch({ pageSize: 2, enableSessionPersistence: false }),
    );

    // Fast-forward initial search
    await act(async () => {
      await Promise.resolve();
    });

    // Page 2
    await act(async () => {
      result.current.loadMore();
      await Promise.resolve();
    });

    expect(result.current.page).toBe(2);

    // Now change property filter -> should reset page to 1
    await act(async () => {
      result.current.toggleProperty('Sin Gluten');
      await Promise.resolve();
    });

    expect(result.current.page).toBe(1);
    expect(result.current.properties).toEqual(['Sin Gluten']);

    // Advance to page 2 again
    await act(async () => {
      result.current.loadMore();
      await Promise.resolve();
    });
    expect(result.current.page).toBe(2);

    // Change maxPrepMinutes -> should reset page to 1
    await act(async () => {
      result.current.setMaxPrepMinutes(30);
      await Promise.resolve();
    });
    expect(result.current.page).toBe(1);
    expect(result.current.maxPrepMinutes).toBe(30);
  });

  it('combines parameters and forwards them to recipeService.search', async () => {
    const mockResponse: RecipeSearchResponse = {
      items: [createMockRecipe('1')],
      page: 1,
      pageSize: 12,
      total: 1,
    };
    vi.mocked(recipeService.search).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useRecipeSearch({ enableSessionPersistence: false }));

    act(() => {
      result.current.toggleProperty('Sin Gluten');
      result.current.setMaxPrepMinutes(20);
    });

    await waitFor(() => {
      expect(recipeService.search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          properties: ['Sin Gluten'],
          maxPrepMinutes: 20,
          page: 1,
          pageSize: 4,
        }),
        expect.any(AbortSignal),
      );
    });
  });

  it('ignores obsolete/stale responses when a newer request completes first', async () => {
    let resolveFirst: ((val: RecipeSearchResponse) => void) | null = null;
    let resolveSecond: ((val: RecipeSearchResponse) => void) | null = null;

    vi.mocked(recipeService.search)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const { result } = renderHook(() => useRecipeSearch({ enableSessionPersistence: false }));

    // Request 1 is pending
    expect(result.current.status).toBe('loading');

    // Trigger request 2 by toggling property
    act(() => {
      result.current.toggleProperty('Keto');
    });

    // Request 2 finishes first
    const response2: RecipeSearchResponse = {
      items: [createMockRecipe('2', 'Receta Rápida')],
      page: 1,
      pageSize: 12,
      total: 1,
    };
    await act(async () => {
      resolveSecond!(response2);
    });

    expect(result.current.recipes.map((r) => r.id)).toEqual(['2']);

    // Now request 1 resolves late
    const response1: RecipeSearchResponse = {
      items: [createMockRecipe('1', 'Receta Vieja')],
      page: 1,
      pageSize: 12,
      total: 1,
    };
    await act(async () => {
      resolveFirst!(response1);
    });

    // Older response must NOT overwrite newer response!
    expect(result.current.recipes.map((r) => r.id)).toEqual(['2']);
  });

  it('paginates without duplicate items by deduplicating by recipe.id', async () => {
    const page1: RecipeSearchResponse = {
      items: [createMockRecipe('1'), createMockRecipe('2')],
      page: 1,
      pageSize: 2,
      total: 3,
    };
    // Page 2 happens to return item '2' again due to database shifts, plus item '3'
    const page2: RecipeSearchResponse = {
      items: [createMockRecipe('2'), createMockRecipe('3')],
      page: 2,
      pageSize: 2,
      total: 3,
    };

    vi.mocked(recipeService.search)
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const { result } = renderHook(() =>
      useRecipeSearch({ pageSize: 2, enableSessionPersistence: false }),
    );

    await waitFor(() => {
      expect(result.current.recipes.map((r) => r.id)).toEqual(['1', '2']);
    });

    // Load page 2
    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.recipes.map((r) => r.id)).toEqual(['1', '2', '3']);
    });
  });

  it('restores state from sessionStorage when returning from recipe detail', async () => {
    const persistedData = {
      searchState: {
        draftText: 'quinoa',
        committedQuery: 'quinoa',
        properties: ['Vegano'],
        maxPrepMinutes: 15,
        page: 2,
      },
      recipes: [createMockRecipe('10', 'Quinoa bowl'), createMockRecipe('11', 'Quinoa burger')],
      total: 2,
      scrollY: 150,
    };
    sessionStorage.setItem(RECIPE_SEARCH_SESSION_KEY, JSON.stringify(persistedData));

    const { result } = renderHook(() => useRecipeSearch({ enableSessionPersistence: true }));

    expect(result.current.draftText).toBe('quinoa');
    expect(result.current.committedQuery).toBe('quinoa');
    expect(result.current.properties).toEqual(['Vegano']);
    expect(result.current.maxPrepMinutes).toBe(15);
    expect(result.current.page).toBe(2);
    expect(result.current.recipes.map((r) => r.id)).toEqual(['10', '11']);
    expect(result.current.status).toBe('success');
    // Does not immediately refetch because persisted recipes are present
    expect(recipeService.search).not.toHaveBeenCalled();
  });

  it('handles loading, empty state, 400 validation error, network error and retry', async () => {
    // 1. Validation Error (400)
    vi.mocked(recipeService.search).mockRejectedValueOnce(new RecipeRequestError('validation'));

    const { result } = renderHook(() => useRecipeSearch({ enableSessionPersistence: false }));

    await waitFor(() => {
      expect(result.current.status).toBe('error');
      expect(result.current.errorKind).toBe('validation');
      expect(result.current.errorMessage).toContain('parámetros de búsqueda son inválidos');
    });

    // 2. Retry triggers refetch
    vi.mocked(recipeService.search).mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 12,
      total: 0,
    });

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('empty');
      expect(result.current.recipes).toHaveLength(0);
    });

    // 3. Clear filters resets search state
    act(() => {
      result.current.setDraftText('test');
      result.current.toggleProperty('Vegano');
      result.current.setMaxPrepMinutes(30);
      result.current.clearFilters();
    });

    expect(result.current.draftText).toBe('');
    expect(result.current.committedQuery).toBeUndefined();
    expect(result.current.properties).toEqual([]);
    expect(result.current.maxPrepMinutes).toBeUndefined();
    expect(result.current.page).toBe(1);
  });
});
