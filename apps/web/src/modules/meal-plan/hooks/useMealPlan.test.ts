import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMealPlan } from './useMealPlan';
import { mealPlanService } from '../../../services/mealPlanService';
import { mealPlanFixture } from '../mealPlanFixture';

vi.mock('../../../services/mealPlanService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/mealPlanService')>();
  return {
    ...actual,
    mealPlanService: { getCurrentMealPlan: vi.fn() },
  };
});

describe('useMealPlan', () => {
  beforeEach(() => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockReset();
  });

  it('loads the plan and sets status to success', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(mealPlanFixture);

    const { result } = renderHook(() => useMealPlan('2026-08-24'));

    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.mealPlan).toEqual(mealPlanFixture);
  });

  it('sets status to empty when the service resolves no plan', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(null);

    const { result } = renderHook(() => useMealPlan('2026-08-24'));

    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(result.current.mealPlan).toBeNull();
  });

  it('keeps the last valid plan when a retry fails', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(mealPlanFixture);

    const { result } = renderHook(() => useMealPlan('2026-08-24'));
    await waitFor(() => expect(result.current.status).toBe('success'));

    vi.mocked(mealPlanService.getCurrentMealPlan).mockRejectedValueOnce(new Error('network error'));
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.mealPlan).toEqual(mealPlanFixture);
  });
});
