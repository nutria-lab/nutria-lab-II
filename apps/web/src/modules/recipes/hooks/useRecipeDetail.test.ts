import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRecipeDetail } from './useRecipeDetail';
import { recipeService, RecipeRequestError, type Recipe } from '../../../services/recipeService';

// NUT-20 (primera iteración, tester) — `useRecipeDetail` todavía NO EXISTE. Recurso por id,
// con su propio `status`/`error` independiente del listado (design.md 1.1): a diferencia de
// `useRecipes`, agrega un estado `notFound` distinto del error genérico cuando el servicio
// rechaza con `RecipeRequestError('notFound')` (design.md 1.3/4.2 — pantalla de "no
// encontrada" distinta del error genérico). También debe recargar cuando cambia el `id` con
// el que se invoca. Se espera ROJO hoy, mayormente por módulo inexistente.

vi.mock('../../../services/recipeService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/recipeService')>();
  return {
    ...actual,
    recipeService: { ...actual.recipeService, getById: vi.fn() },
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

describe('useRecipeDetail', () => {
  beforeEach(() => {
    vi.mocked(recipeService.getById).mockReset();
  });

  it('loads the recipe by id on mount and exposes it with status "success"', async () => {
    const recipe = buildRecipe();
    vi.mocked(recipeService.getById).mockResolvedValue(recipe as never);

    const { result } = renderHook(() => useRecipeDetail('recipe-1'));
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.recipe).toEqual(recipe);
    expect(recipeService.getById).toHaveBeenCalledWith('recipe-1', expect.any(AbortSignal));
  });

  it('sets status to "notFound" (distinct from the generic "error") when the service rejects with kind "notFound"', async () => {
    vi.mocked(recipeService.getById).mockRejectedValue(new RecipeRequestError('notFound'));

    const { result } = renderHook(() => useRecipeDetail('missing-recipe'));

    await waitFor(() => expect(result.current.status).toBe('notFound'));
    expect(result.current.recipe).toBeNull();
  });

  it('sets status to "error" (not "notFound") on a generic/network failure', async () => {
    vi.mocked(recipeService.getById).mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useRecipeDetail('recipe-1'));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBeTruthy();
    expect(result.current.status).not.toBe('notFound');
  });

  it('reloads when the id argument changes, instead of staying stuck on the first id', async () => {
    const recipeA = buildRecipe({ id: 'recipe-a', title: 'Receta A' });
    const recipeB = buildRecipe({ id: 'recipe-b', title: 'Receta B' });
    vi.mocked(recipeService.getById).mockImplementation(((id: string) =>
      Promise.resolve(id === 'recipe-a' ? recipeA : recipeB)) as never);

    const { result, rerender } = renderHook(({ id }) => useRecipeDetail(id), {
      initialProps: { id: 'recipe-a' },
    });

    await waitFor(() => expect(result.current.recipe).toEqual(recipeA));

    rerender({ id: 'recipe-b' });

    await waitFor(() => expect(result.current.recipe).toEqual(recipeB));
    expect(recipeService.getById).toHaveBeenCalledWith('recipe-b', expect.any(AbortSignal));
  });

  // NUT-20 (séptima iteración, tester) — Hallazgo 3 (alto) del cuarto review: a diferencia de
  // `useRecipes`/`useIngredients`/`useMealPlan` (que preservan el último dato válido ante un
  // error posterior), `useRecipeDetail` hoy hace `setRecipe(null)` ante CUALQUIER error que no
  // sea `notFound` — design.md sección 4.2 pide expresamente "igual que el listado". Bug real:
  // tras editar con éxito, si el refetch de verificación posterior falla por un hipo de red, la
  // receta recién guardada desaparece de pantalla. Se espera ROJO en el primer test de este
  // bloque (la receta hoy se pisa a `null`); el segundo test es el caso de control de
  // no-regresión (`notFound` sigue limpiando `recipe`), y ya pasa con el código actual.
  describe('preservación del último dato válido ante un error NO "notFound" (Hallazgo 3, cuarto review)', () => {
    it('un retry() que falla con un error genérico conserva el `recipe` ya cargado y sólo cambia status a "error"', async () => {
      const recipe = buildRecipe();
      vi.mocked(recipeService.getById).mockResolvedValueOnce(recipe as never);

      const { result } = renderHook(() => useRecipeDetail('recipe-1'));
      await waitFor(() => expect(result.current.status).toBe('success'));
      expect(result.current.recipe).toEqual(recipe);

      vi.mocked(recipeService.getById).mockRejectedValueOnce(new Error('network hiccup'));
      act(() => {
        result.current.retry();
      });

      await waitFor(() => expect(result.current.status).toBe('error'));
      expect(result.current.recipe).toEqual(recipe);
      expect(result.current.errorMessage).toBeTruthy();
    });

    it('caso de control: un retry() que falla con RecipeRequestError("notFound") SÍ limpia `recipe` a null', async () => {
      const recipe = buildRecipe();
      vi.mocked(recipeService.getById).mockResolvedValueOnce(recipe as never);

      const { result } = renderHook(() => useRecipeDetail('recipe-1'));
      await waitFor(() => expect(result.current.status).toBe('success'));
      expect(result.current.recipe).toEqual(recipe);

      vi.mocked(recipeService.getById).mockRejectedValueOnce(new RecipeRequestError('notFound'));
      act(() => {
        result.current.retry();
      });

      await waitFor(() => expect(result.current.status).toBe('notFound'));
      expect(result.current.recipe).toBeNull();
    });
  });

  it('retry() requests the same id again', async () => {
    vi.mocked(recipeService.getById).mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() => useRecipeDetail('recipe-1'));
    await waitFor(() => expect(result.current.status).toBe('error'));

    const recipe = buildRecipe();
    vi.mocked(recipeService.getById).mockResolvedValueOnce(recipe as never);
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.recipe).toEqual(recipe);
    expect(recipeService.getById).toHaveBeenCalledTimes(2);
    expect(vi.mocked(recipeService.getById).mock.calls[1]?.[0]).toBe('recipe-1');
  });
});
