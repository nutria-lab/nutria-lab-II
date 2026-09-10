import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  nutritionProfileService,
  NutritionProfileNotFoundError,
  type NutritionProfile,
} from './nutritionProfileService';
import { apiClient } from './apiClient';

vi.mock('./apiClient', () => ({
  apiClient: { get: vi.fn(), put: vi.fn() },
}));

const sampleProfile: NutritionProfile = {
  goal: 'LOSE_WEIGHT',
  diet: 'VEGAN',
  excludedIngredients: ['NUTS'],
  cookTimePreference: 'STANDARD',
};

describe('nutritionProfileService', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.put).mockReset();
  });

  it('getProfile returns the profile on success', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: sampleProfile });

    const result = await nutritionProfileService.getProfile();

    expect(result).toEqual(sampleProfile);
  });

  it('getProfile throws NutritionProfileNotFoundError on 404', async () => {
    const axiosError = Object.assign(new Error('Not Found'), {
      isAxiosError: true,
      response: { status: 404 },
    });
    vi.mocked(apiClient.get).mockRejectedValue(axiosError);

    await expect(nutritionProfileService.getProfile()).rejects.toBeInstanceOf(NutritionProfileNotFoundError);
  });

  it('getProfile rethrows other errors as-is', async () => {
    const axiosError = Object.assign(new Error('Server error'), {
      isAxiosError: true,
      response: { status: 500 },
    });
    vi.mocked(apiClient.get).mockRejectedValue(axiosError);

    await expect(nutritionProfileService.getProfile()).rejects.toThrow('Server error');
  });

  it('updateProfile sends the full profile and returns what the server persisted', async () => {
    vi.mocked(apiClient.put).mockResolvedValue({ data: sampleProfile });

    const result = await nutritionProfileService.updateProfile(sampleProfile);

    expect(result).toEqual(sampleProfile);
    expect(apiClient.put).toHaveBeenCalledWith('/nutrition-profile', sampleProfile);
  });
});
