import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useIngredients } from './useIngredients';
import { ingredientService, type Ingredient } from '../../../services/ingredientService';

// NUT-20 (primera iteración, tester) — `useIngredients` todavía NO EXISTE. Mismo patrón que
// `useRecipes` (design.md 1.1), aplicado al catálogo de ingredientes: alimenta tanto el
// listado standalone de ingredientes como el selector de conveniencia del formulario de
// receta (sólo lectura, sin creación inline — design.md 2.2). Se espera ROJO hoy, mayormente
// por módulo inexistente.

vi.mock('../../../services/ingredientService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/ingredientService')>();
  return {
    ...actual,
    ingredientService: { ...actual.ingredientService, list: vi.fn() },
  };
});

function buildIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'ingredient-1',
    name: 'Quinoa',
    description: 'Cereal andino sin gluten',
    type: 'GRAIN',
    defaultUnit: 'g',
    nutritionalValues: { calories: 120, protein: 4, carbs: 21, fat: 2, fiber: 3 },
    properties: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('useIngredients', () => {
  beforeEach(() => {
    vi.mocked(ingredientService.list).mockReset();
  });

  it('loads the ingredient catalog on mount and exposes it with status "success"', async () => {
    const ingredients = [buildIngredient(), buildIngredient({ id: 'ingredient-2', name: 'Avena' })];
    vi.mocked(ingredientService.list).mockResolvedValue(ingredients as never);

    const { result } = renderHook(() => useIngredients());
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.ingredients).toEqual(ingredients);
  });

  it('sets status to "empty" (distinct from "error") when the catalog has no ingredients yet', async () => {
    vi.mocked(ingredientService.list).mockResolvedValue([] as never);

    const { result } = renderHook(() => useIngredients());

    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(result.current.ingredients).toEqual([]);
  });

  it('sets status to "error" with a message on a backend/network failure', async () => {
    vi.mocked(ingredientService.list).mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useIngredients());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBeTruthy();
  });

  it('keeps a previously loaded catalog when a later retry() fails, instead of clearing it', async () => {
    const ingredients = [buildIngredient()];
    vi.mocked(ingredientService.list).mockResolvedValueOnce(ingredients as never);

    const { result } = renderHook(() => useIngredients());
    await waitFor(() => expect(result.current.status).toBe('success'));

    vi.mocked(ingredientService.list).mockRejectedValueOnce(new Error('network error'));
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.ingredients).toEqual(ingredients);
  });

  it('retry() requests the catalog again', async () => {
    vi.mocked(ingredientService.list).mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() => useIngredients());
    await waitFor(() => expect(result.current.status).toBe('error'));

    const ingredients = [buildIngredient()];
    vi.mocked(ingredientService.list).mockResolvedValueOnce(ingredients as never);
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.ingredients).toEqual(ingredients);
    expect(ingredientService.list).toHaveBeenCalledTimes(2);
  });

  it('exposes an explicit refetch() that can be triggered from outside (e.g. after creating an ingredient standalone)', async () => {
    const initial = [buildIngredient()];
    vi.mocked(ingredientService.list).mockResolvedValueOnce(initial as never);

    const { result } = renderHook(() => useIngredients());
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(typeof result.current.refetch).toBe('function');

    const updated = [buildIngredient(), buildIngredient({ id: 'ingredient-2', name: 'Avena' })];
    vi.mocked(ingredientService.list).mockResolvedValueOnce(updated as never);

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.ingredients).toEqual(updated));
    expect(ingredientService.list).toHaveBeenCalledTimes(2);
  });
});
