import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REPLACE_MEAL_ERROR_MESSAGE, useReplaceMeal } from '@/modules/meal-plan/hooks/useReplaceMeal';
import { mealPlanService, type PlannedMeal } from '@/services/mealPlanService';

vi.mock('@/services/mealPlanService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/mealPlanService')>();
  return { ...actual, mealPlanService: { replacePlannedMeal: vi.fn() } };
});

const MEAL: PlannedMeal = {
  id: 'meal-1',
  dayId: 'day-1',
  mealType: 'BREAKFAST',
  title: 'Avena con frutos rojos',
  nutritionalValues: { Protein: 12, Fiber: 5, Calories: 320, Description: 'Rica en fibra' },
  recipeId: null,
  recipe: null,
};

describe('useReplaceMeal', () => {
  beforeEach(() => {
    vi.mocked(mealPlanService.replacePlannedMeal).mockReset();
  });

  it.each([
    ['an Error with a technical message', new Error('Request failed with status code 503')],
    ['an Error without message', new Error('')],
    ['a non-Error rejection', { detail: 'internal' }],
  ])('exposes a fixed error message for %s', async (_label, rejection) => {
    vi.mocked(mealPlanService.replacePlannedMeal).mockRejectedValue(rejection);
    const onError = vi.fn();
    const { result } = renderHook(() => useReplaceMeal({ onError }));

    await act(async () => {
      await result.current.replaceMeal('plan-1', MEAL);
    });

    expect(result.current.replaceError?.message).toBe(REPLACE_MEAL_ERROR_MESSAGE);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: REPLACE_MEAL_ERROR_MESSAGE }));
  });

  it('uses the approved fixed copy', () => {
    expect(REPLACE_MEAL_ERROR_MESSAGE).toBe('No pudimos reemplazar la comida. Podés reintentar o cancelar.');
  });
});
