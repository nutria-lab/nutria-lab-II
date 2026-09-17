import axios from 'axios';

import { apiClient } from './apiClient';

export type IngredientType = 'MEAT' | 'VEGETABLE' | 'FRUIT' | 'DAIRY' | 'GRAIN' | 'SPICE' | 'OTHER';

export type IngredientNutritionalValues = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sodium?: number;
};

export type Ingredient = {
  id: string;
  name: string;
  description: string | null;
  type: IngredientType;
  defaultUnit: string | null;
  nutritionalValues: IngredientNutritionalValues;
  properties: string[];
  createdAt: string;
  updatedAt: string;
};

export type CreateIngredientRequest = {
  name: string;
  description?: string;
  type: IngredientType;
  defaultUnit: string;
  nutritionalValues: IngredientNutritionalValues;
  properties: string[];
};

export type UpdateIngredientRequest = Partial<CreateIngredientRequest>;

export type IngredientErrorKind = 'notFound' | 'validation' | 'conflict' | 'timeout' | 'network' | 'unexpected';

const INGREDIENT_REQUEST_TIMEOUT_MS = 10_000;

export class IngredientRequestError extends Error {
  constructor(public readonly kind: IngredientErrorKind) {
    super(kind);
    this.name = 'IngredientRequestError';
  }
}

// Mismo criterio que `recipeErrorKind`/`registrationErrorKind`: sólo se llama cuando ya se
// descartó que el error sea un 401/403 (design.md 1.4 — se propagan sin envolver).
function ingredientErrorKind(error: unknown): IngredientErrorKind {
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

  throw new IngredientRequestError(ingredientErrorKind(error));
}

export const ingredientService = {
  async list(signal: AbortSignal = new AbortController().signal): Promise<Ingredient[]> {
    try {
      const response = await apiClient.get<Ingredient[]>('/ingredients', {
        timeout: INGREDIENT_REQUEST_TIMEOUT_MS,
        signal,
      });
      return response.data;
    } catch (error) {
      return rethrow(error);
    }
  },

  async getById(id: string, signal: AbortSignal = new AbortController().signal): Promise<Ingredient> {
    try {
      const response = await apiClient.get<Ingredient>(`/ingredients/${id}`, {
        timeout: INGREDIENT_REQUEST_TIMEOUT_MS,
        signal,
      });
      return response.data;
    } catch (error) {
      return rethrow(error);
    }
  },

  async create(
    payload: CreateIngredientRequest,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<Ingredient> {
    try {
      const response = await apiClient.post<Ingredient>('/ingredients', payload, {
        timeout: INGREDIENT_REQUEST_TIMEOUT_MS,
        signal,
      });
      return response.data;
    } catch (error) {
      return rethrow(error);
    }
  },

  async update(
    id: string,
    payload: UpdateIngredientRequest,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<Ingredient> {
    try {
      const response = await apiClient.patch<Ingredient>(`/ingredients/${id}`, payload, {
        timeout: INGREDIENT_REQUEST_TIMEOUT_MS,
        signal,
      });
      return response.data;
    } catch (error) {
      return rethrow(error);
    }
  },

  async remove(id: string, signal: AbortSignal = new AbortController().signal): Promise<void> {
    try {
      await apiClient.delete(`/ingredients/${id}`, {
        timeout: INGREDIENT_REQUEST_TIMEOUT_MS,
        signal,
      });
    } catch (error) {
      return rethrow(error);
    }
  },
};
