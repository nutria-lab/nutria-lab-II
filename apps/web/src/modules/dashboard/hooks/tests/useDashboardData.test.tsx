import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { AxiosError, AxiosHeaders, CanceledError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdherenceResponse } from '@/modules/adherence/types';
import type { MealPlan } from '@/services/mealPlanService';
import { mealPlanService } from '@/services/mealPlanService';
import type { ShoppingProgress } from '../../types';
import { dashboardAdherenceService } from '../../services/dashboardAdherenceService';
import { dashboardShoppingService } from '../../services/dashboardShoppingService';
import { useDashboardData } from '../useDashboardData';

vi.mock('@/services/mealPlanService', () => ({
  mealPlanService: { getCurrentMealPlan: vi.fn() },
}));
vi.mock('../../services/dashboardAdherenceService', () => ({
  dashboardAdherenceService: { getForWeek: vi.fn() },
}));
vi.mock('../../services/dashboardShoppingService', () => ({
  dashboardShoppingService: { getForWeek: vi.fn() },
}));

const getPlan = vi.mocked(mealPlanService.getCurrentMealPlan);
const getAdherence = vi.mocked(dashboardAdherenceService.getForWeek);
const getShopping = vi.mocked(dashboardShoppingService.getForWeek);

// Miércoles 21/10/2026 12:00 en Buenos Aires.
const NOW = new Date('2026-10-21T15:00:00.000Z');
const WEEK = '2026-10-19';
const TODAY = '2026-10-21';
const IMAGE = {
  provider: 'UNSPLASH' as const,
  imageUrl: 'https://example.test/avena.jpg',
  alt: 'Avena',
  photographer: 'P',
  photographerUrl: 'https://example.test/p',
  sourceUrl: 'https://example.test/s',
};

function mealPlan(id = 'plan-1'): MealPlan {
  return {
    id,
    userId: 'u1',
    startDate: `${WEEK}T00:00:00.000Z`,
    endDate: '2026-10-25T00:00:00.000Z',
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
    days: [
      {
        id: 'd3',
        mealPlanId: id,
        day: 'WEDNESDAY',
        date: TODAY,
        meals: [
          {
            id: 'pm-dinner',
            dayId: 'd3',
            mealType: 'DINNER',
            title: 'Plan cena',
            nutritionalValues: { Protein: 1, Fiber: 1, Calories: 1, Description: '' },
            recipeId: null,
            recipe: null,
          },
          {
            id: 'pm-breakfast',
            dayId: 'd3',
            mealType: 'BREAKFAST',
            title: 'Plan desayuno',
            nutritionalValues: { Protein: 1, Fiber: 1, Calories: 1, Description: '' },
            recipeId: 'r-1',
            recipe: { id: 'r-1', title: 'Avena', ingredients: [], instructions: [], image: IMAGE },
          },
        ],
      },
    ],
  };
}

function adherence(planId: string | null = 'plan-1', completed = 1): AdherenceResponse {
  if (planId === null) {
    return {
      weekStart: WEEK,
      timezone: 'America/Argentina/Buenos_Aires',
      today: TODAY,
      plan: null,
      days: [],
      summary: { plannedMeals: 0, completedMeals: 0, skippedMeals: 0, notLoggedMeals: 0, adherencePercent: null },
    };
  }
  return {
    weekStart: WEEK,
    timezone: 'America/Argentina/Buenos_Aires',
    today: TODAY,
    plan: { id: planId, version: 1, updatedAt: '2026-10-18T00:00:00.000Z' },
    days: [
      {
        date: TODAY,
        plannedMeals: 2,
        completedMeals: completed,
        skippedMeals: 0,
        notLoggedMeals: 2 - completed,
        adherencePercent: completed * 50,
        meals: [
          {
            plannedMealId: 'pm-dinner',
            mealUpdatedAt: '2026-10-18T00:00:00.000Z',
            recipeId: null,
            mealType: 'DINNER',
            title: 'Cena',
            status: 'NOT_LOGGED',
            canEdit: true,
          },
          {
            plannedMealId: 'pm-breakfast',
            mealUpdatedAt: '2026-10-18T00:00:00.000Z',
            recipeId: 'r-1',
            mealType: 'BREAKFAST',
            title: 'Desayuno',
            status: completed > 0 ? 'COMPLETED' : 'NOT_LOGGED',
            canEdit: true,
          },
        ],
      },
    ],
    summary: {
      plannedMeals: 2,
      completedMeals: completed,
      skippedMeals: 0,
      notLoggedMeals: 2 - completed,
      adherencePercent: completed * 50,
    },
  };
}

function shopping(planId: string | null = 'plan-1', checked = 1): ShoppingProgress {
  return {
    weekStart: WEEK,
    plan: planId === null ? null : { id: planId, version: 1, updatedAt: '2026-10-18T00:00:00.000Z' },
    summary: planId === null ? { totalItems: 0, checkedItems: 0 } : { totalItems: 5, checkedItems: checked },
  };
}

function httpError(status: number, data: unknown = { message: 'texto del backend que nunca se muestra' }) {
  return new AxiosError('fail', String(status), undefined, undefined, {
    status,
    statusText: '',
    data,
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mockAllOk() {
  getPlan.mockResolvedValue(mealPlan());
  getAdherence.mockResolvedValue(adherence());
  getShopping.mockResolvedValue(shopping());
}

type HookProps = { userId: string | null; userName?: string | null; enabled?: boolean };

function renderDashboard(initial: HookProps = { userId: 'u1' }) {
  return renderHook((props: HookProps) => useDashboardData({ userName: null, enabled: true, ...props }), {
    initialProps: initial,
  });
}

async function settled(result: { current: ReturnType<typeof useDashboardData> }) {
  await waitFor(() => expect(result.current.todayMeals.kind).not.toBe('loading'));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  getPlan.mockReset();
  getAdherence.mockReset();
  getShopping.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useDashboardData — initial load and success', () => {
  it('requests the three resources for the Buenos Aires week with one shared abort signal', async () => {
    mockAllOk();
    const { result } = renderDashboard();

    await settled(result);

    expect(getPlan).toHaveBeenCalledWith(WEEK, expect.any(AbortSignal));
    expect(getAdherence).toHaveBeenCalledWith(WEEK, expect.any(AbortSignal));
    expect(getShopping).toHaveBeenCalledWith(WEEK, expect.any(AbortSignal));
    expect(getAdherence.mock.calls[0][1]).toBe(getPlan.mock.calls[0][1]);
  });

  it('shows loading in every card while the first load is in flight (never "no disponible")', () => {
    getPlan.mockReturnValue(new Promise(() => {}));
    getAdherence.mockReturnValue(new Promise(() => {}));
    getShopping.mockReturnValue(new Promise(() => {}));

    const { result } = renderDashboard();

    expect(result.current.todayMeals).toEqual({ kind: 'loading' });
    expect(result.current.adherence).toMatchObject({ data: null, loading: true, error: null });
    expect(result.current.shopping).toEqual({ kind: 'loading' });
  });

  it('CA1: passes contract A and contract C values through unchanged', async () => {
    mockAllOk();
    const { result } = renderDashboard();

    await settled(result);

    expect(result.current.adherence.data).toEqual(adherence());
    expect(result.current.adherence).toMatchObject({ loading: false, error: null, expectedWeekStart: WEEK, expectedPlanId: 'plan-1' });
    expect(result.current.shopping).toEqual({ kind: 'ready', data: shopping() });
  });

  it("builds today's meals from adherence, sorted, with the plan recipe image when there is one", async () => {
    mockAllOk();
    const { result } = renderDashboard();

    await settled(result);

    expect(result.current.todayMeals).toEqual({
      kind: 'ready',
      data: {
        kind: 'meals',
        meals: [
          { plannedMealId: 'pm-breakfast', mealType: 'BREAKFAST', title: 'Desayuno', recipeId: 'r-1', status: 'COMPLETED', image: IMAGE },
          { plannedMealId: 'pm-dinner', mealType: 'DINNER', title: 'Cena', recipeId: null, status: 'NOT_LOGGED', image: null },
        ],
      },
    });
  });

  it('passes the session name through', async () => {
    mockAllOk();
    const { result } = renderDashboard({ userId: 'u1', userName: 'María José' });

    await settled(result);

    expect(result.current.userName).toBe('María José');
  });
});

describe('useDashboardData — CA4: 404 vs 500 of the plan endpoint', () => {
  it('a 404 (service returns null) with no plan in A and C is the "no plan" state', async () => {
    getPlan.mockResolvedValue(null);
    getAdherence.mockResolvedValue(adherence(null));
    getShopping.mockResolvedValue(shopping(null));
    const { result } = renderDashboard();

    await settled(result);

    expect(result.current.todayMeals).toEqual({ kind: 'ready', data: { kind: 'noPlan' } });
    expect(result.current.adherence).toMatchObject({ expectedPlanId: null, error: null });
  });

  it('a 500 is a recoverable error, never "no plan"; the other cards stay usable', async () => {
    getPlan.mockRejectedValue(httpError(500));
    getAdherence.mockResolvedValue(adherence());
    getShopping.mockResolvedValue(shopping());
    const { result } = renderDashboard();

    await settled(result);

    expect(result.current.todayMeals.kind).toBe('error');
    expect(result.current.adherence.data).toEqual(adherence());
    expect(result.current.adherence.expectedPlanId).toBeUndefined();
    expect(result.current.shopping.kind).toBe('ready');
  });

  it('a plan of another week is an error, never "no meals today" (adherence and shopping failing)', async () => {
    getPlan.mockResolvedValue({ ...mealPlan(), startDate: '2026-10-12T00:00:00.000Z' });
    getAdherence.mockRejectedValue(httpError(500));
    getShopping.mockRejectedValue(httpError(500));
    const { result } = renderDashboard();

    await settled(result);

    expect(result.current.todayMeals.kind).toBe('error');
  });

  it('a malformed meal in the plan is a recoverable error instead of breaking the render', async () => {
    const plan = mealPlan();
    const broken = { ...plan, days: [{ ...plan.days[0], meals: [null, plan.days[0].meals[0]] }] } as unknown as MealPlan;
    getPlan.mockResolvedValue(broken);
    getAdherence.mockRejectedValue(httpError(500));
    getShopping.mockResolvedValue(shopping());
    const { result } = renderDashboard();

    await settled(result);

    expect(result.current.todayMeals.kind).toBe('error');
    expect(result.current.shopping.kind).toBe('ready');
  });

  it('Reintentar after a 500 requests the plan again and recovers', async () => {
    getPlan.mockRejectedValueOnce(httpError(500)).mockResolvedValue(mealPlan());
    getAdherence.mockResolvedValue(adherence());
    getShopping.mockResolvedValue(shopping());
    const { result } = renderDashboard();
    await settled(result);
    const state = result.current.todayMeals;
    if (state.kind !== 'error') throw new Error('expected error');

    act(() => state.retry());

    await waitFor(() => expect(result.current.todayMeals.kind).toBe('ready'));
    expect(getPlan).toHaveBeenCalledTimes(2);
  });
});

describe('useDashboardData — CA3: planId mismatch', () => {
  it('refetches everything exactly once and shows the consistent second answer', async () => {
    getPlan.mockResolvedValue(mealPlan('plan-2'));
    getAdherence.mockResolvedValueOnce(adherence('plan-1')).mockResolvedValue(adherence('plan-2'));
    getShopping.mockResolvedValueOnce(shopping('plan-1')).mockResolvedValue(shopping('plan-2'));
    const { result } = renderDashboard();

    await waitFor(() => expect(result.current.adherence.data?.plan?.id).toBe('plan-2'));

    expect(getPlan).toHaveBeenCalledTimes(2);
    expect(getAdherence).toHaveBeenCalledTimes(2);
    expect(getShopping).toHaveBeenCalledTimes(2);
    expect(result.current.todayMeals.kind).toBe('ready');
  });

  it('aborts the first round before refetching', async () => {
    getPlan.mockResolvedValue(mealPlan('plan-2'));
    getAdherence.mockResolvedValueOnce(adherence('plan-1')).mockResolvedValue(adherence('plan-2'));
    getShopping.mockResolvedValue(shopping('plan-2'));
    const { result } = renderDashboard();

    await waitFor(() => expect(getPlan).toHaveBeenCalledTimes(2));
    await settled(result);

    expect((getPlan.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    expect((getPlan.mock.calls[1][1] as AbortSignal).aborted).toBe(false);
  });

  it('a null plan in one response and an id in another is also a mismatch', async () => {
    getPlan.mockResolvedValue(null);
    getAdherence.mockResolvedValue(adherence('plan-1'));
    getShopping.mockResolvedValue(shopping(null));
    const { result } = renderDashboard();

    await settled(result);

    expect(getPlan).toHaveBeenCalledTimes(2);
    expect(result.current.todayMeals.kind).toBe('error');
  });

  it('if it persists, every data card is a recoverable error and no data from either version is shown', async () => {
    getPlan.mockResolvedValue(mealPlan('plan-2'));
    getAdherence.mockResolvedValue(adherence('plan-1'));
    getShopping.mockResolvedValue(shopping('plan-2'));
    const { result } = renderDashboard();

    await settled(result);

    expect(getPlan).toHaveBeenCalledTimes(2);
    expect(getAdherence).toHaveBeenCalledTimes(2);
    expect(result.current.todayMeals.kind).toBe('error');
    expect(result.current.adherence).toMatchObject({ data: null, loading: false });
    expect(result.current.adherence.error).not.toBeNull();
    expect(result.current.shopping.kind).toBe('error');
  });

  it('Reintentar after a persistent conflict runs a new bounded round', async () => {
    getPlan.mockResolvedValue(mealPlan('plan-2'));
    getAdherence.mockResolvedValue(adherence('plan-1'));
    getShopping.mockResolvedValue(shopping('plan-2'));
    const { result } = renderDashboard();
    await settled(result);

    getAdherence.mockResolvedValue(adherence('plan-2'));
    act(() => result.current.adherence.onRetry());

    await waitFor(() => expect(result.current.adherence.data?.plan?.id).toBe('plan-2'));
    expect(getAdherence).toHaveBeenCalledTimes(3);
  });

  it('a conflict that persists after Reintentar stops again after one bounded refetch', async () => {
    getPlan.mockResolvedValue(mealPlan('plan-2'));
    getAdherence.mockResolvedValue(adherence('plan-1'));
    getShopping.mockResolvedValue(shopping('plan-2'));
    const { result } = renderDashboard();
    await settled(result);

    act(() => result.current.adherence.onRetry());

    await waitFor(() => expect(getAdherence).toHaveBeenCalledTimes(4));
    await settled(result);
    expect(result.current.todayMeals.kind).toBe('error');
    expect(result.current.adherence.data).toBeNull();
    expect(getPlan).toHaveBeenCalledTimes(4);
  });

  it('a failed resource does not take part in the comparison', async () => {
    getPlan.mockResolvedValue(mealPlan('plan-1'));
    getAdherence.mockRejectedValue(httpError(500));
    getShopping.mockResolvedValue(shopping('plan-1'));
    const { result } = renderDashboard();

    await settled(result);

    expect(getPlan).toHaveBeenCalledTimes(1);
    expect(result.current.shopping.kind).toBe('ready');
  });
});

describe('useDashboardData — CA5: partial failures', () => {
  it("adherence 500: today's meals come from the plan without status, the widget errors, shopping is usable", async () => {
    getPlan.mockResolvedValue(mealPlan());
    getAdherence.mockRejectedValue(httpError(500));
    getShopping.mockResolvedValue(shopping());
    const { result } = renderDashboard();

    await settled(result);

    expect(result.current.todayMeals).toEqual({
      kind: 'ready',
      data: {
        kind: 'meals',
        meals: [
          { plannedMealId: 'pm-breakfast', mealType: 'BREAKFAST', title: 'Plan desayuno', recipeId: 'r-1', status: null, image: IMAGE },
          { plannedMealId: 'pm-dinner', mealType: 'DINNER', title: 'Plan cena', recipeId: null, status: null, image: null },
        ],
      },
    });
    expect(result.current.adherence).toMatchObject({ data: null, loading: false });
    expect(result.current.adherence.error).not.toBeNull();
    expect(result.current.shopping.kind).toBe('ready');
  });

  it('the internal error value never carries the backend message', async () => {
    getPlan.mockResolvedValue(mealPlan());
    getAdherence.mockRejectedValue(httpError(500));
    getShopping.mockResolvedValue(shopping());
    const { result } = renderDashboard();

    await settled(result);

    expect(result.current.adherence.error).not.toMatch(/backend|fail/);
  });

  it('shopping 500: only the shopping access errors, with retry', async () => {
    getPlan.mockResolvedValue(mealPlan());
    getAdherence.mockResolvedValue(adherence());
    getShopping.mockRejectedValue(httpError(500));
    const { result } = renderDashboard();

    await settled(result);

    expect(result.current.shopping).toEqual({ kind: 'error', retry: expect.any(Function) });
    expect(result.current.todayMeals.kind).toBe('ready');
    expect(result.current.adherence.data).toEqual(adherence());
  });

  it('all three fail: three independent errors, none stuck in loading', async () => {
    getPlan.mockRejectedValue(httpError(500));
    getAdherence.mockRejectedValue(httpError(500));
    getShopping.mockRejectedValue(httpError(500));
    const { result } = renderDashboard();

    await settled(result);

    expect(result.current.todayMeals.kind).toBe('error');
    expect(result.current.adherence).toMatchObject({ data: null, loading: false });
    expect(result.current.adherence.error).not.toBeNull();
    expect(result.current.shopping.kind).toBe('error');
  });
});

describe('useDashboardData — CA5: 401 is handled by the global session', () => {
  it('a 401 on adherence is not an error for the widget: it is "no disponible", not loading', async () => {
    getPlan.mockResolvedValue(mealPlan());
    getAdherence.mockRejectedValue(httpError(401));
    getShopping.mockResolvedValue(shopping());
    const { result } = renderDashboard();

    await settled(result);

    expect(result.current.adherence).toMatchObject({ data: null, loading: false, error: null });
  });

  it('a 403 (also closed by the global session) is treated like a 401', async () => {
    getPlan.mockResolvedValue(mealPlan());
    getAdherence.mockRejectedValue(httpError(403));
    getShopping.mockRejectedValue(httpError(403));
    const { result } = renderDashboard();

    await settled(result);

    expect(result.current.adherence).toMatchObject({ data: null, loading: false, error: null });
    expect(result.current.shopping).toEqual({ kind: 'unavailable' });
  });

  it('the access-gate 403 is "no disponible" without Reintentar: retrying could never succeed', async () => {
    getPlan.mockResolvedValue(mealPlan());
    getAdherence.mockRejectedValue(httpError(403, { code: 'ACCESS_GATE_REQUIRED' }));
    getShopping.mockRejectedValue(httpError(403, { code: 'ACCESS_GATE_REQUIRED' }));
    const { result } = renderDashboard();

    await settled(result);

    expect(result.current.shopping).toEqual({ kind: 'unavailable' });
    expect(result.current.adherence).toMatchObject({ data: null, loading: false, error: null });
  });

  it('a 401 on the plan leaves the meals card unavailable, not in error', async () => {
    getPlan.mockRejectedValue(httpError(401));
    getAdherence.mockRejectedValue(httpError(401));
    getShopping.mockRejectedValue(httpError(401));
    const { result } = renderDashboard();

    await settled(result);

    expect(result.current.todayMeals).toEqual({ kind: 'unavailable' });
    expect(result.current.shopping).toEqual({ kind: 'unavailable' });
    expect(result.current.adherence).toMatchObject({ data: null, loading: false, error: null });
  });
});

describe('useDashboardData — CA5: stale responses and cancellation', () => {
  it('a slower response from an earlier request is ignored after Reintentar', async () => {
    const first = deferred<AdherenceResponse>();
    getPlan.mockResolvedValue(mealPlan());
    getShopping.mockResolvedValue(shopping());
    getAdherence.mockReturnValueOnce(first.promise).mockResolvedValue(adherence('plan-1', 2));
    const { result } = renderDashboard();

    act(() => result.current.adherence.onRetry());
    await waitFor(() => expect(result.current.adherence.data?.summary.completedMeals).toBe(2));

    await act(async () => {
      first.resolve(adherence('plan-1', 0));
      await first.promise;
    });

    expect(result.current.adherence.data?.summary.completedMeals).toBe(2);
    expect((getAdherence.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
  });

  it('the cancellation of a superseded request is never shown as an error', async () => {
    const first = deferred<MealPlan | null>();
    getPlan.mockReturnValueOnce(first.promise).mockResolvedValue(mealPlan());
    getAdherence.mockResolvedValue(adherence());
    getShopping.mockResolvedValue(shopping());
    const { result } = renderDashboard();

    act(() => result.current.adherence.onRetry());
    await act(async () => {
      first.reject(new CanceledError());
      await first.promise.catch(() => undefined);
    });
    await settled(result);

    expect(result.current.todayMeals.kind).toBe('ready');
  });

  it('a cancellation we did not request (current request) is a recoverable error, never a stuck loading', async () => {
    getPlan.mockRejectedValue(new CanceledError());
    getAdherence.mockResolvedValue(adherence());
    getShopping.mockResolvedValue(shopping());
    const { result } = renderDashboard();

    await settled(result);

    expect(result.current.todayMeals.kind).toBe('error');
    expect(result.current.adherence.data).toEqual(adherence());
  });

  it('under StrictMode the first mount is aborted and a single consistent result is shown', async () => {
    mockAllOk();
    const { result } = renderHook(() => useDashboardData({ userId: 'u1', userName: null, enabled: true }), {
      wrapper: StrictMode,
    });

    await settled(result);

    expect((getPlan.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    expect((getPlan.mock.calls.at(-1)?.[1] as AbortSignal).aborted).toBe(false);
    expect(result.current.adherence.data).toEqual(adherence());
  });

  it('unmounting aborts the in-flight requests and a late answer does not warn', async () => {
    const pending = deferred<MealPlan | null>();
    getPlan.mockReturnValue(pending.promise);
    getAdherence.mockReturnValue(new Promise(() => {}));
    getShopping.mockReturnValue(new Promise(() => {}));
    const errorSpy = vi.spyOn(console, 'error');
    const { unmount } = renderDashboard();

    unmount();
    await act(async () => {
      pending.resolve(mealPlan());
      await pending.promise;
    });

    expect((getPlan.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('useDashboardData — CA2: refresh and identity', () => {
  it('returning to the tab refreshes while keeping the current data visible, then shows the new summary', async () => {
    mockAllOk();
    const { result } = renderDashboard();
    await settled(result);
    vi.setSystemTime(new Date(NOW.getTime() + 30_000));
    const next = deferred<AdherenceResponse>();
    getAdherence.mockReturnValueOnce(next.promise);
    getShopping.mockResolvedValue(shopping('plan-1', 4));

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.adherence).toMatchObject({ loading: true });
    expect(result.current.adherence.data).toEqual(adherence());
    expect(result.current.todayMeals.kind).toBe('ready');

    await act(async () => {
      next.resolve(adherence('plan-1', 2));
      await next.promise;
    });

    await waitFor(() => expect(result.current.adherence.data?.summary.completedMeals).toBe(2));
    expect(result.current.shopping).toEqual({ kind: 'ready', data: shopping('plan-1', 4) });
  });

  it('returning to the tab after Sunday midnight (Buenos Aires) requests the new week and hides the old data', async () => {
    vi.setSystemTime(new Date('2026-10-26T02:50:00.000Z')); // domingo 23:50 ART
    mockAllOk();
    const { result } = renderDashboard();
    await settled(result);
    getPlan.mockReturnValue(new Promise(() => {}));
    getAdherence.mockReturnValue(new Promise(() => {}));
    getShopping.mockReturnValue(new Promise(() => {}));
    vi.setSystemTime(new Date('2026-10-26T03:10:00.000Z')); // lunes 00:10 ART

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(getPlan).toHaveBeenLastCalledWith('2026-10-26', expect.any(AbortSignal)));
    expect(result.current.todayMeals).toEqual({ kind: 'loading' });
    expect(result.current.adherence.data).toBeNull();
  });

  it('Reintentar after Sunday midnight requests the new week, not the old one', async () => {
    vi.setSystemTime(new Date('2026-10-26T02:50:00.000Z'));
    getPlan.mockRejectedValue(httpError(500));
    getAdherence.mockResolvedValue(adherence());
    getShopping.mockResolvedValue(shopping());
    const { result } = renderDashboard();
    await settled(result);
    vi.setSystemTime(new Date('2026-10-26T03:10:00.000Z'));

    act(() => result.current.adherence.onRetry());

    await waitFor(() => expect(getPlan).toHaveBeenLastCalledWith('2026-10-26', expect.any(AbortSignal)));
  });

  it('returning to the tab less than 30 s after the last load does not refetch', async () => {
    mockAllOk();
    const { result } = renderDashboard();
    await settled(result);
    vi.setSystemTime(new Date(NOW.getTime() + 29_999));

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(getPlan).toHaveBeenCalledTimes(1);
    expect(getAdherence).toHaveBeenCalledTimes(1);
    expect(getShopping).toHaveBeenCalledTimes(1);
  });

  it('the 30 s window counts from the last load, including a Reintentar', async () => {
    mockAllOk();
    const { result } = renderDashboard();
    await settled(result);
    vi.setSystemTime(new Date(NOW.getTime() + 20_000));
    act(() => result.current.adherence.onRetry());
    await settled(result);
    vi.setSystemTime(new Date(NOW.getTime() + 40_000));

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(getPlan).toHaveBeenCalledTimes(2);
  });

  it('Reintentar is never throttled', async () => {
    mockAllOk();
    const { result } = renderDashboard();
    await settled(result);

    act(() => result.current.adherence.onRetry());

    await waitFor(() => expect(getPlan).toHaveBeenCalledTimes(2));
  });

  it('a hidden tab does not refetch', async () => {
    mockAllOk();
    const { result } = renderDashboard();
    await settled(result);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(getAdherence).toHaveBeenCalledTimes(1);
  });

  it('remounting (coming back from the planner or the shopping list) fetches fresh data', async () => {
    mockAllOk();
    const first = renderDashboard();
    await settled(first.result);
    first.unmount();
    getAdherence.mockResolvedValue(adherence('plan-1', 2));

    const second = renderDashboard();

    expect(second.result.current.todayMeals).toEqual({ kind: 'loading' });
    await waitFor(() => expect(second.result.current.adherence.data?.summary.completedMeals).toBe(2));
  });

  it("a session user change never shows the previous user's data, not even for one render", async () => {
    mockAllOk();
    const { result, rerender } = renderDashboard({ userId: 'u1' });
    await settled(result);
    getPlan.mockReturnValue(new Promise(() => {}));
    getAdherence.mockReturnValue(new Promise(() => {}));
    getShopping.mockReturnValue(new Promise(() => {}));

    rerender({ userId: 'u2' });

    expect(result.current.todayMeals).toEqual({ kind: 'loading' });
    expect(result.current.adherence.data).toBeNull();
    expect(result.current.shopping).toEqual({ kind: 'loading' });
    expect(getPlan).toHaveBeenCalledTimes(2);
  });

  it('a refresh that fails keeps retained data only if it belongs to the new plan version', async () => {
    mockAllOk();
    const { result } = renderDashboard();
    await settled(result);
    getPlan.mockResolvedValue(mealPlan('plan-2'));
    getAdherence.mockRejectedValue(httpError(500));
    getShopping.mockResolvedValue(shopping('plan-2'));

    act(() => result.current.adherence.onRetry());

    await waitFor(() => expect(result.current.adherence.loading).toBe(false));
    expect(result.current.adherence.data).toBeNull();
    expect(result.current.adherence.error).not.toBeNull();
  });

  it('a refresh that fails for the same plan version keeps the data with a non-blocking error', async () => {
    mockAllOk();
    const { result } = renderDashboard();
    await settled(result);
    getAdherence.mockRejectedValue(httpError(500));

    act(() => result.current.adherence.onRetry());

    await waitFor(() => expect(result.current.adherence.loading).toBe(false));
    expect(result.current.adherence.data).toEqual(adherence());
    expect(result.current.adherence.error).not.toBeNull();
  });

  it('without a session user nothing is requested and nothing is loading', () => {
    const { result } = renderDashboard({ userId: null });

    expect(getPlan).not.toHaveBeenCalled();
    expect(result.current.todayMeals).toEqual({ kind: 'unavailable' });
    expect(result.current.adherence).toMatchObject({ data: null, loading: false, error: null });
    expect(result.current.shopping).toEqual({ kind: 'unavailable' });
  });

  it('disabled (dev fixture selected) requests nothing', () => {
    renderDashboard({ userId: 'u1', enabled: false });

    expect(getPlan).not.toHaveBeenCalled();
    expect(getAdherence).not.toHaveBeenCalled();
    expect(getShopping).not.toHaveBeenCalled();
  });
});
