import { act, renderHook, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adherenceService } from '@/services/adherenceService';
import { useAdherence } from '@/modules/adherence/hooks/useAdherence';
import { adherenceFixture } from '@/modules/adherence/fixtures/adherence.fixture';

const mockAuth = vi.hoisted(() => ({
  status: 'authenticated' as 'authenticated' | 'anonymous' | 'initializing',
  user: { id: 'user-1' } as { id: string } | null,
}));

vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
vi.mock('@/services/adherenceService', () => ({
  adherenceService: { getForWeek: vi.fn(), setMealStatus: vi.fn() },
}));

const editableMeal = adherenceFixture.days.flatMap((day) => day.meals)
  .find((meal) => meal.canEdit)!;

function withMealStatus(status: 'NOT_LOGGED' | 'COMPLETED' | 'SKIPPED', updatedAt: string) {
  return {
    ...adherenceFixture,
    days: adherenceFixture.days.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => meal.plannedMealId === editableMeal.plannedMealId
        ? { ...meal, status, mealUpdatedAt: updatedAt }
        : meal),
    })),
  };
}

function staleError() {
  const error = new AxiosError('stale');
  error.response = {
    status: 409,
    data: { code: 'ADHERENCE_STALE' },
    statusText: 'Conflict',
    headers: {},
    config: {} as never,
  };
  return error;
}

beforeEach(() => {
  mockAuth.status = 'authenticated';
  mockAuth.user = { id: 'user-1' };
  vi.mocked(adherenceService.getForWeek).mockReset().mockResolvedValue(adherenceFixture);
  vi.mocked(adherenceService.setMealStatus).mockReset();
});

describe('useAdherence', () => {
  it('loads the requested week and sends the server snapshot with an absolute status', async () => {
    let resolveRefresh!: (value: typeof adherenceFixture) => void;
    const refresh = new Promise<typeof adherenceFixture>((resolve) => {
      resolveRefresh = resolve;
    });
    vi.mocked(adherenceService.setMealStatus).mockResolvedValue({
      plannedMealId: editableMeal.plannedMealId,
      status: 'COMPLETED',
      updatedAt: '2026-10-22T13:00:00.000Z',
    });
    vi.mocked(adherenceService.getForWeek)
      .mockResolvedValueOnce(adherenceFixture)
      .mockReturnValueOnce(refresh);

    const { result } = renderHook(() => useAdherence('2026-10-19'));
    await waitFor(() => expect(result.current.data?.weekStart).toBe('2026-10-19'));

    await act(async () => {
      await result.current.setMealStatus(editableMeal.plannedMealId, 'COMPLETED');
    });

    expect(adherenceService.getForWeek).toHaveBeenCalledWith('2026-10-19', expect.any(AbortSignal));
    expect(adherenceService.setMealStatus).toHaveBeenCalledExactlyOnceWith(
      editableMeal.plannedMealId,
      {
        planId: adherenceFixture.plan!.id,
        mealUpdatedAt: editableMeal.mealUpdatedAt,
        status: 'COMPLETED',
      },
      expect.any(AbortSignal),
    );
    expect(result.current.data?.days[0].meals.find((meal) => meal.plannedMealId === editableMeal.plannedMealId)?.status)
      .toBe('COMPLETED');
    expect(result.current.data?.days[0].meals.find((meal) => meal.plannedMealId === editableMeal.plannedMealId)?.mealUpdatedAt)
      .toBe(editableMeal.mealUpdatedAt);

    await act(async () => {
      resolveRefresh(withMealStatus('COMPLETED', editableMeal.mealUpdatedAt));
      await refresh;
    });
  });

  it('blocks a second request for the same meal while its PUT is pending', async () => {
    let resolve!: (value: { plannedMealId: string; status: 'COMPLETED'; updatedAt: string }) => void;
    const pendingPut = new Promise<{ plannedMealId: string; status: 'COMPLETED'; updatedAt: string }>((done) => {
      resolve = done;
    });
    vi.mocked(adherenceService.setMealStatus).mockReturnValue(pendingPut);
    const { result } = renderHook(() => useAdherence('2026-10-19'));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    act(() => {
      void result.current.setMealStatus(editableMeal.plannedMealId, 'COMPLETED');
      void result.current.setMealStatus(editableMeal.plannedMealId, 'SKIPPED');
    });
    await waitFor(() => expect(adherenceService.setMealStatus).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolve({
        plannedMealId: editableMeal.plannedMealId,
        status: 'COMPLETED',
        updatedAt: '2026-10-22T13:00:00.000Z',
      });
      await pendingPut;
    });
  });

  it('keeps the confirmed state after a network failure', async () => {
    vi.mocked(adherenceService.setMealStatus).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useAdherence('2026-10-19'));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await act(async () => {
      await result.current.setMealStatus(editableMeal.plannedMealId, 'COMPLETED');
    });

    expect(result.current.data?.days[0].meals.find((meal) => meal.plannedMealId === editableMeal.plannedMealId)?.status)
      .toBe('NOT_LOGGED');
    expect(result.current.itemErrors[editableMeal.plannedMealId]).toMatch(/estado anterior sigue activo/i);
  });

  it('reloads the plan and adherence after ADHERENCE_STALE without replaying the PUT', async () => {
    const reloadPlan = vi.fn().mockResolvedValue({ id: adherenceFixture.plan!.id });
    vi.mocked(adherenceService.setMealStatus).mockRejectedValueOnce(staleError());
    const { result } = renderHook(() => useAdherence('2026-10-19', { reloadPlan }));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await act(async () => {
      await result.current.setMealStatus(editableMeal.plannedMealId, 'COMPLETED');
    });

    expect(reloadPlan).toHaveBeenCalledOnce();
    expect(adherenceService.getForWeek).toHaveBeenCalledTimes(2);
    expect(adherenceService.setMealStatus).toHaveBeenCalledOnce();
    expect(result.current.itemErrors[editableMeal.plannedMealId]).toMatch(/volvé a elegir/i);
  });

  it('does not send writes for meals the server marks read-only', async () => {
    const readOnly = {
      ...adherenceFixture,
      days: adherenceFixture.days.map((day) => ({
        ...day,
        meals: day.meals.map((meal) => meal.plannedMealId === editableMeal.plannedMealId
          ? { ...meal, canEdit: false }
          : meal),
      })),
    };
    vi.mocked(adherenceService.getForWeek).mockResolvedValue(readOnly);
    const { result } = renderHook(() => useAdherence('2026-10-19'));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await act(async () => {
      await result.current.setMealStatus(editableMeal.plannedMealId, 'COMPLETED');
    });

    expect(adherenceService.setMealStatus).not.toHaveBeenCalled();
  });
});
