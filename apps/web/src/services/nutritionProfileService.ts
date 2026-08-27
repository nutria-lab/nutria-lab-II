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

const MOCK_DELAY_MS = 500;

let mockProfile: NutritionProfile = {
  goal: 'LOSE_WEIGHT',
  diet: 'VEGAN',
  excludedIngredients: ['NUTS'],
  cookTimePreference: 'STANDARD',
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// TODO: reemplazar por llamadas reales a /nutrition-profile cuando el
// endpoint exista. La forma de las funciones (getProfile/updateProfile,
// mismos tipos de entrada/salida) ya coincide con el service real futuro.
export const nutritionProfileService = {
  async getProfile(): Promise<NutritionProfile> {
    await delay(MOCK_DELAY_MS);
    return { ...mockProfile };
  },

  async updateProfile(profile: NutritionProfile): Promise<NutritionProfile> {
    await delay(MOCK_DELAY_MS);
    mockProfile = { ...profile };
    return { ...mockProfile };
  },
};
