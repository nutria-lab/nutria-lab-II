import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShoppingListResponse } from '@/modules/shopping-list/types';
import { apiClient } from '@/services/apiClient';
import { dashboardShoppingService, isShoppingProgress } from '../dashboardShoppingService';

vi.mock('@/services/apiClient', () => ({
  apiClient: { get: vi.fn() },
}));

const WEEK = '2026-10-19';
const PLAN = { id: 'plan-1', version: 2, updatedAt: '2026-10-19T09:00:00.000Z' };

function contractResponse(): ShoppingListResponse {
  return {
    weekStart: WEEK,
    plan: PLAN,
    items: [
      { key: 'k1', name: 'avena', quantity: 200, unit: 'g', checked: true, sources: [] },
      { key: 'k2', name: 'leche', quantity: 1, unit: 'l', checked: false, sources: [] },
    ],
    summary: { totalItems: 2, checkedItems: 1 },
    warnings: [],
  };
}

const get = vi.mocked(apiClient.get);

beforeEach(() => {
  get.mockReset();
});

describe('dashboardShoppingService.getForWeek', () => {
  it('requests GET /shopping-list with the week and signal and returns only weekStart, plan and summary', async () => {
    get.mockResolvedValue({ data: contractResponse() });
    const controller = new AbortController();

    const result = await dashboardShoppingService.getForWeek(WEEK, controller.signal);

    expect(get).toHaveBeenCalledWith(
      '/shopping-list',
      expect.objectContaining({ params: { weekStart: WEEK }, signal: controller.signal }),
    );
    expect(result).toEqual({ weekStart: WEEK, plan: PLAN, summary: { totalItems: 2, checkedItems: 1 } });
  });

  it('returns the summary counters exactly as contract C sends them, without recounting items', async () => {
    get.mockResolvedValue({ data: { ...contractResponse(), summary: { totalItems: 7, checkedItems: 3 } } });

    const result = await dashboardShoppingService.getForWeek(WEEK, new AbortController().signal);

    expect(result.summary).toEqual({ totalItems: 7, checkedItems: 3 });
  });

  it('rejects a response for another week', async () => {
    get.mockResolvedValue({ data: { ...contractResponse(), weekStart: '2026-10-12' } });

    await expect(dashboardShoppingService.getForWeek(WEEK, new AbortController().signal)).rejects.toThrow();
  });

  it.each([401, 500])('propagates HTTP %s as the original axios error', async (status) => {
    const error = new AxiosError('fail', String(status), undefined, undefined, {
      status,
      statusText: '',
      data: {},
      headers: {},
      config: { headers: new AxiosHeaders() },
    });
    get.mockRejectedValue(error);

    await expect(dashboardShoppingService.getForWeek(WEEK, new AbortController().signal)).rejects.toBe(error);
  });
});

describe('isShoppingProgress', () => {
  it('accepts no plan with zero counters', () => {
    expect(isShoppingProgress({ weekStart: WEEK, plan: null, summary: { totalItems: 0, checkedItems: 0 } })).toBe(true);
  });

  it.each([
    ['plan without updatedAt', { plan: { id: 'p', version: 1 } }],
    ['plan with string version', { plan: { ...PLAN, version: '1' } }],
    ['negative total', { summary: { totalItems: -1, checkedItems: 0 } }],
    ['fractional checked', { summary: { totalItems: 2, checkedItems: 0.5 } }],
    ['checked above total', { summary: { totalItems: 1, checkedItems: 2 } }],
    ['no plan with items counted', { plan: null, summary: { totalItems: 1, checkedItems: 0 } }],
    ['missing summary', { summary: undefined }],
  ])('rejects %s', (_label, patch) => {
    expect(isShoppingProgress({ weekStart: WEEK, plan: PLAN, summary: { totalItems: 2, checkedItems: 1 }, ...patch })).toBe(
      false,
    );
  });
});
