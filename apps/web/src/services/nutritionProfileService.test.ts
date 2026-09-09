import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  nutritionProfileService,
  NutritionProfileNotFoundError,
  type NutritionProfile,
} from './nutritionProfileService';
import { http } from './http';

vi.mock('./http', () => ({
  http: { get: vi.fn(), put: vi.fn() },
}));

const sampleProfile: NutritionProfile = {
  goal: 'LOSE_WEIGHT',
  diet: 'VEGAN',
  excludedIngredients: ['NUTS'],
  cookTimePreference: 'STANDARD',
};

describe('nutritionProfileService', () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset();
    vi.mocked(http.put).mockReset();
  });

  it('getProfile returns the profile on success', async () => {
    vi.mocked(http.get).mockResolvedValue({ data: sampleProfile });

    const result = await nutritionProfileService.getProfile();

    expect(result).toEqual(sampleProfile);
  });

  it('getProfile throws NutritionProfileNotFoundError on 404', async () => {
    const axiosError = Object.assign(new Error('Not Found'), {
      isAxiosError: true,
      response: { status: 404 },
    });
    vi.mocked(http.get).mockRejectedValue(axiosError);

    await expect(nutritionProfileService.getProfile()).rejects.toBeInstanceOf(NutritionProfileNotFoundError);
  });

  it('getProfile rethrows other errors as-is', async () => {
    const axiosError = Object.assign(new Error('Server error'), {
      isAxiosError: true,
      response: { status: 500 },
    });
    vi.mocked(http.get).mockRejectedValue(axiosError);

    await expect(nutritionProfileService.getProfile()).rejects.toThrow('Server error');
  });

  it('updateProfile sends the full profile and returns what the server persisted', async () => {
    vi.mocked(http.put).mockResolvedValue({ data: sampleProfile });

    const result = await nutritionProfileService.updateProfile(sampleProfile);

    expect(result).toEqual(sampleProfile);
    expect(http.put).toHaveBeenCalledWith('/nutrition-profile', sampleProfile);
  });
});
