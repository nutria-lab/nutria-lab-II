import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mealPlanService } from './mealPlanService';
import { http } from './http';

vi.mock('./http', () => ({
  http: { get: vi.fn() },
}));

describe('mealPlanService.getCurrentMealPlan', () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
  });

  it('normalizes a day with a missing meals array to an empty array', async () => {
    vi.mocked(http.get).mockResolvedValue({
      data: {
        id: 'plan-1',
        weekStart: '2026-08-24',
        days: [{ date: '2026-08-24' }],
      },
    });

    const result = await mealPlanService.getCurrentMealPlan('2026-08-24');

    expect(result?.days[0].meals).toEqual([]);
  });

  it('returns null when the API responds 404 (no plan for the week)', async () => {
    const axiosError = Object.assign(new Error('Not Found'), {
      isAxiosError: true,
      response: { status: 404 },
    });
    vi.mocked(http.get).mockRejectedValue(axiosError);

    const result = await mealPlanService.getCurrentMealPlan('2026-08-24');

    expect(result).toBeNull();
  });

  it('throws when the response does not look like a MealPlan', async () => {
    vi.mocked(http.get).mockResolvedValue({ data: '<html>not json</html>' });

    await expect(mealPlanService.getCurrentMealPlan('2026-08-24')).rejects.toThrow();
  });
});
