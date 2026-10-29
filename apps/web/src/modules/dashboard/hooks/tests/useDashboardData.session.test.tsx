import { renderHook, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient, setAuthFailureHandler } from '@/services/apiClient';
import { mealPlanService } from '@/services/mealPlanService';
import { dashboardAdherenceService } from '../../services/dashboardAdherenceService';
import { dashboardShoppingService } from '../../services/dashboardShoppingService';
import { useDashboardData } from '../useDashboardData';

// Integración con el apiClient real: solo se reemplaza la capa de red (adapter). Verifica que los
// pedidos del Inicio pasan por el manejo global de sesión y que, además, las tarjetas no muestran error.

const NOW = new Date('2026-10-21T15:00:00.000Z');
const WEEK = '2026-10-19';

function failingAdapter(status: number, data: unknown = {}): AxiosAdapter {
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const response: AxiosResponse = { data, status, statusText: 'Error', headers: {}, config };
    throw new AxiosError(`Request failed with status ${status}`, AxiosError.ERR_BAD_REQUEST, config, undefined, response);
  };
}

const originalAdapter = apiClient.defaults.adapter;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter;
  setAuthFailureHandler(null);
  vi.useRealTimers();
});

describe('dashboard requests and the global session handler (real apiClient)', () => {
  it.each([
    ['meal plan', () => mealPlanService.getCurrentMealPlan(WEEK, new AbortController().signal)],
    ['adherence', () => dashboardAdherenceService.getForWeek(WEEK, new AbortController().signal)],
    ['shopping', () => dashboardShoppingService.getForWeek(WEEK, new AbortController().signal)],
  ])('%s: a 401 calls the global handler and still rejects to the caller', async (_label, request) => {
    const handler = vi.fn();
    setAuthFailureHandler(handler);
    apiClient.defaults.adapter = failingAdapter(401);

    await expect(request()).rejects.toMatchObject({ response: { status: 401 } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['adherence', () => dashboardAdherenceService.getForWeek(WEEK, new AbortController().signal)],
    ['shopping', () => dashboardShoppingService.getForWeek(WEEK, new AbortController().signal)],
  ])('%s: a session 403 calls the global handler', async (_label, request) => {
    const handler = vi.fn();
    setAuthFailureHandler(handler);
    apiClient.defaults.adapter = failingAdapter(403);

    await expect(request()).rejects.toMatchObject({ response: { status: 403 } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('the access-gate 403 does not call the session handler (the access gate owns it)', async () => {
    const handler = vi.fn();
    setAuthFailureHandler(handler);
    apiClient.defaults.adapter = failingAdapter(403, { code: 'ACCESS_GATE_REQUIRED' });

    await expect(dashboardAdherenceService.getForWeek(WEEK, new AbortController().signal)).rejects.toMatchObject({
      response: { status: 403 },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'through the coordinator: a %s on all three requests calls the handler once and leaves every card unavailable',
    async (status) => {
      const handler = vi.fn();
      setAuthFailureHandler(handler);
      apiClient.defaults.adapter = failingAdapter(status);

      const { result } = renderHook(() => useDashboardData({ userId: 'u1', userName: null, enabled: true }));

      await waitFor(() => expect(result.current.todayMeals).toEqual({ kind: 'unavailable' }));
      expect(result.current.shopping).toEqual({ kind: 'unavailable' });
      expect(result.current.adherence).toMatchObject({ data: null, loading: false, error: null });
      // apiClient deduplica los fallos de sesión simultáneos: una sola invalidación.
      expect(handler).toHaveBeenCalledTimes(1);
    },
  );
});
