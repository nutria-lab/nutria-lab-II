import axios from 'axios';

import { apiClient } from './apiClient';

export type RecipeCategory =
  | 'VEGAN'
  | 'VEGETARIAN'
  | 'HIGH_PROTEIN'
  | 'GLUTEN_FREE'
  | 'DAIRY_FREE'
  | 'LOW_CARB'
  | 'OTHER';

export type RecipeIngredientItem = {
  name: string;
  quantity: number;
  unit: string;
};

export type RecipeNutritionalValues = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type Recipe = {
  id: string;
  title: string;
  description: string;
  categories: RecipeCategory[];
  prepMinutes: number;
  cookMinutes: number;
  ingredients: RecipeIngredientItem[];
  instructions: string[];
  nutritionalValues: RecipeNutritionalValues | null;
  properties: string[];
  createdAt: string;
  updatedAt: string;
};

export type CreateRecipeRequest = {
  title: string;
  description: string;
  categories: RecipeCategory[];
  prepMinutes: number;
  cookMinutes: number;
  ingredients: RecipeIngredientItem[];
  instructions: string[];
  nutritionalValues: RecipeNutritionalValues;
  properties: string[];
};

export type UpdateRecipeRequest = Partial<CreateRecipeRequest>;

export type RecipeErrorKind = 'notFound' | 'validation' | 'conflict' | 'timeout' | 'network' | 'unexpected';

const RECIPE_REQUEST_TIMEOUT_MS = 10_000;

export class RecipeRequestError extends Error {
  constructor(public readonly kind: RecipeErrorKind) {
    super(kind);
    this.name = 'RecipeRequestError';
  }
}

// Mismo criterio que `registrationErrorKind` (`registerService.ts`): sólo se llama cuando ya
// se descartó que el error sea un 401/403 (design.md 1.4 — esos se propagan sin envolver,
// los resuelve el interceptor global de `apiClient`, no esta clase de error de dominio).
function recipeErrorKind(error: unknown): RecipeErrorKind {
  if (!axios.isAxiosError(error)) {
    return 'unexpected';
  }

  const status = error.response?.status;

  if (error.code === 'ECONNABORTED') {
    return 'timeout';
  }

  if (error.code === axios.AxiosError.ERR_CANCELED) {
    return 'network';
  }

  if (status === 404) {
    return 'notFound';
  }

  if (status === 409) {
    return 'conflict';
  }

  if (status === 400 || status === 422) {
    return 'validation';
  }

  return error.response ? 'unexpected' : 'network';
}

function isUnauthorized(error: unknown): boolean {
  return axios.isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403);
}

function rethrow(error: unknown): never {
  if (isUnauthorized(error)) {
    throw error;
  }

  throw new RecipeRequestError(recipeErrorKind(error));
}

export const recipeService = {
  async list(signal: AbortSignal = new AbortController().signal): Promise<Recipe[]> {
    try {
      const response = await apiClient.get<Recipe[]>('/recipes', {
        timeout: RECIPE_REQUEST_TIMEOUT_MS,
        signal,
      });
      return response.data;
    } catch (error) {
      return rethrow(error);
    }
  },

  async getById(id: string, signal: AbortSignal = new AbortController().signal): Promise<Recipe> {
    try {
      const response = await apiClient.get<Recipe>(`/recipes/${id}`, {
        timeout: RECIPE_REQUEST_TIMEOUT_MS,
        signal,
      });
      return response.data;
    } catch (error) {
      return rethrow(error);
    }
  },

  async create(
    payload: CreateRecipeRequest,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<Recipe> {
    try {
      const response = await apiClient.post<Recipe>('/recipes', payload, {
        timeout: RECIPE_REQUEST_TIMEOUT_MS,
        signal,
      });
      return response.data;
    } catch (error) {
      return rethrow(error);
    }
  },

  async update(
    id: string,
    payload: UpdateRecipeRequest,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<Recipe> {
    try {
      const response = await apiClient.patch<Recipe>(`/recipes/${id}`, payload, {
        timeout: RECIPE_REQUEST_TIMEOUT_MS,
        signal,
      });
      return response.data;
    } catch (error) {
      return rethrow(error);
    }
  },

  async remove(id: string, signal: AbortSignal = new AbortController().signal): Promise<void> {
    try {
      await apiClient.delete(`/recipes/${id}`, {
        timeout: RECIPE_REQUEST_TIMEOUT_MS,
        signal,
      });
    } catch (error) {
      return rethrow(error);
    }
  },
};
