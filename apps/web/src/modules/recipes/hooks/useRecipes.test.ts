import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRecipes } from './useRecipes';
import { recipeService, type Recipe } from '../../../services/recipeService';

// NUT-20 (primera iteración, tester) — `useRecipes` todavía NO EXISTE. Se sigue el patrón
// manual (sin librería de data-fetching) de `useMealPlan.ts`: `status` con
// 'loading'|'empty'|'error'|'success', "última petición gana" vía AbortController propio, no
// se borra una colección previa válida ante un error de un `retry()` posterior, y se agrega
// `refetch()` como método explícito (design.md 1.2: refetch completo de la colección al
// volver a mostrarse la pantalla tras una mutación en otro flujo). Se espera ROJO hoy,
// mayormente por módulo inexistente.

vi.mock('../../../services/recipeService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/recipeService')>();
  return {
    ...actual,
    recipeService: { ...actual.recipeService, list: vi.fn() },
  };
});

function buildRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'recipe-1',
    title: 'Bowl de quinoa',
    description: 'Bowl fresco con vegetales de estación',
    categories: ['VEGAN'],
    prepMinutes: 10,
    cookMinutes: 15,
    ingredients: [{ name: 'Quinoa', quantity: 200, unit: 'g' }],
    instructions: ['Cocinar la quinoa'],
    nutritionalValues: { calories: 420, protein: 18, carbs: 55, fat: 12 },
    properties: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('useRecipes', () => {
  beforeEach(() => {
    vi.mocked(recipeService.list).mockReset();
  });

  it('loads the recipe collection on mount and exposes it with status "success"', async () => {
    const recipes = [buildRecipe(), buildRecipe({ id: 'recipe-2' })];
    vi.mocked(recipeService.list).mockResolvedValue(recipes as never);

    const { result } = renderHook(() => useRecipes());
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.recipes).toEqual(recipes);
  });

  it('sets status to "empty" (distinct from "error") when the backend returns no recipes yet', async () => {
    vi.mocked(recipeService.list).mockResolvedValue([] as never);

    const { result } = renderHook(() => useRecipes());

    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(result.current.recipes).toEqual([]);
  });

  it('sets status to "error" with a message on a backend/network failure', async () => {
    vi.mocked(recipeService.list).mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useRecipes());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBeTruthy();
  });

  it('keeps a previously loaded collection when a later retry() fails, instead of clearing it', async () => {
    const recipes = [buildRecipe()];
    vi.mocked(recipeService.list).mockResolvedValueOnce(recipes as never);

    const { result } = renderHook(() => useRecipes());
    await waitFor(() => expect(result.current.status).toBe('success'));

    vi.mocked(recipeService.list).mockRejectedValueOnce(new Error('network error'));
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.recipes).toEqual(recipes);
  });

  it('retry() requests the data again', async () => {
    vi.mocked(recipeService.list).mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() => useRecipes());
    await waitFor(() => expect(result.current.status).toBe('error'));

    const recipes = [buildRecipe()];
    vi.mocked(recipeService.list).mockResolvedValueOnce(recipes as never);
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.recipes).toEqual(recipes);
    expect(recipeService.list).toHaveBeenCalledTimes(2);
  });

  it('exposes an explicit refetch() that can be triggered from outside (e.g. after creating/editing/deleting a recipe elsewhere)', async () => {
    const initial = [buildRecipe()];
    vi.mocked(recipeService.list).mockResolvedValueOnce(initial as never);

    const { result } = renderHook(() => useRecipes());
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(typeof result.current.refetch).toBe('function');

    const updated = [buildRecipe(), buildRecipe({ id: 'recipe-2' })];
    vi.mocked(recipeService.list).mockResolvedValueOnce(updated as never);

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.recipes).toEqual(updated));
    expect(recipeService.list).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale response when a newer overlapping request resolves before it (last request wins)', async () => {
    let resolveFirst!: (value: Recipe[]) => void;
    let resolveSecond!: (value: Recipe[]) => void;
    const firstPromise = new Promise<Recipe[]>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise<Recipe[]>((resolve) => {
      resolveSecond = resolve;
    });

    vi.mocked(recipeService.list)
      .mockReturnValueOnce(firstPromise as never)
      .mockReturnValueOnce(secondPromise as never);

    const { result } = renderHook(() => useRecipes());
    expect(result.current.status).toBe('loading');

    act(() => {
      result.current.refetch();
    });

    const OLD = [buildRecipe({ id: 'old' })];
    const NEW = [buildRecipe({ id: 'new' })];

    act(() => {
      resolveSecond(NEW);
    });
    await waitFor(() => expect(result.current.recipes).toEqual(NEW));

    act(() => {
      resolveFirst(OLD);
    });
    // Le da lugar al `.then()` de la promesa obsoleta y al scheduler de React para que
    // aplique cualquier `setState` disparado fuera de `act()`, siguiendo el mismo criterio ya
    // usado en `useMealPlan.test.ts` para esta misma condición de carrera.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(result.current.recipes).toEqual(NEW);
    expect(result.current.status).toBe('success');
  });
});
