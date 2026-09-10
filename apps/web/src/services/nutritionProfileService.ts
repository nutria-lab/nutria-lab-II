import axios from 'axios';
import { apiClient } from './apiClient';

export type Goal = 'LOSE_WEIGHT' | 'GAIN_MUSCLE' | 'MAINTAIN';

export type Diet = 'VEGAN' | 'VEGETARIAN' | 'PALEO' | 'KETO' | 'PESCATARIAN' | 'ALL';

export type Restriction = 'NUTS' | 'GLUTEN' | 'DAIRY' | 'SHELLFISH' | 'SOY';

export type CookTimePreference = 'QUICK' | 'STANDARD' | 'GOURMET';

export type NutritionProfile = {
  goal: Goal;
  diet: Diet;
  excludedIngredients: Restriction[];
  cookTimePreference: CookTimePreference;
};

// Señal explícita de "todavía no existe perfil" — se lanza en vez de devolver
// null para no romper la firma Promise<NutritionProfile> que pide el ticket.
export class NutritionProfileNotFoundError extends Error {
  constructor() {
    super('Todavía no existe un perfil nutricional para este usuario.');
    this.name = 'NutritionProfileNotFoundError';
  }
}

export const nutritionProfileService = {
  async getProfile(): Promise<NutritionProfile> {
    try {
      const response = await apiClient.get<NutritionProfile>('/nutrition-profile');
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new NutritionProfileNotFoundError();
      }
      throw error;
    }
  },

  async updateProfile(profile: NutritionProfile): Promise<NutritionProfile> {
    const response = await apiClient.put<NutritionProfile>('/nutrition-profile', profile);
    return response.data;
  },
};
