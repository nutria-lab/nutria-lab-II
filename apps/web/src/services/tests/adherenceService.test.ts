import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/services/apiClient';
import { adherenceService } from '@/services/adherenceService';

vi.mock('@/services/apiClient', () => ({
  apiClient: { get: vi.fn(), put: vi.fn() },
}));

describe('adherenceService', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.put).mockReset();
  });

  it('gets adherence for the requested calendar week using the authenticated api client', async () => {
    const signal = new AbortController().signal;
    const response = { weekStart: '2026-10-19', days: [], summary: {} };
    vi.mocked(apiClient.get).mockResolvedValue({ data: response } as never);

    await expect(adherenceService.getForWeek('2026-10-19', signal)).resolves.toEqual(response);
    expect(apiClient.get).toHaveBeenCalledWith('/adherence', {
      params: { weekStart: '2026-10-19' },
      timeout: 10_000,
      signal,
    });
  });

  it('sends only the meal id and contract body for an absolute status update', async () => {
    const signal = new AbortController().signal;
    const body = {
      planId: 'plan-1',
      mealUpdatedAt: '2026-10-19T12:00:00.000Z',
      status: 'COMPLETED' as const,
    };
    const response = {
      plannedMealId: 'meal-1',
      status: 'COMPLETED' as const,
      updatedAt: '2026-10-22T13:00:00.000Z',
    };
    vi.mocked(apiClient.put).mockResolvedValue({ data: response } as never);

    await expect(adherenceService.setMealStatus('meal-1', body, signal)).resolves.toEqual(response);
    expect(apiClient.put).toHaveBeenCalledWith('/adherence/meals/meal-1', body, {
      signal,
      timeout: 10_000,
    });
    expect(body).not.toHaveProperty('userId');
  });
});
