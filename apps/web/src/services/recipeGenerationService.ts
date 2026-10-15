import axios from 'axios';

import { apiClient } from './apiClient';
import type { RecipeCategory, RecipeImage } from './recipeService';

export type RecipeGenerationMode = 'SINGLE' | 'BATCH';
export type RecipeGenerationCountMode = 'TOTAL_DESIRED' | 'NEW_ONLY';

export type RecipeGenerationRequest = {
  mode: RecipeGenerationMode;
  countMode: RecipeGenerationCountMode;
  count: number;
  description?: string;
  topic?: string;
  categories?: RecipeCategory[];
  properties?: string[];
  maxPrepMinutes?: number;
};

export type RecipeDraft = {
  draftId: string;
  recipe: {
    title: string;
    description: string;
    prepMinutes: number;
    cookMinutes: number;
    ingredients: Array<{ name: string; quantity: number | null; unit: string }>;
    instructions: string[];
    categories: RecipeCategory[];
    properties: string[];
    nutritionalValues: Record<string, number | string | undefined>;
  };
  image: RecipeImage | null;
  warnings: Array<{ code: string; message: string }>;
};

export type ReusedRecipe = {
  recipe: Partial<RecipeDraft['recipe']> & { id?: string };
  score?: number;
  matchReasons?: string[];
  reusedFromValidation?: boolean;
};

export type RejectedRecipe = {
  candidateIndex: number | null;
  codes: string[];
  errors?: Array<{ code: string; field?: string; message: string }>;
};

export type RecipePreview = {
  generationRunId: string;
  status: 'READY_FOR_REVIEW' | 'CONFIRMED';
  requestedCount: number;
  reused: ReusedRecipe[];
  drafts: RecipeDraft[];
  rejected: RejectedRecipe[];
  summary: { requested: number; reused: number; generated: number };
  expiresAt: string | null;
};

export type RecipeConfirmation = {
  generationRunId: string;
  items: Array<{ id: string; image: RecipeImage | null }>;
};

export type RecipeGenerationErrorStatus = 400 | 409 | 422 | 429 | 503 | undefined;

export class RecipeGenerationError extends Error {
  constructor(
    message: string,
    public readonly status: RecipeGenerationErrorStatus,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RecipeGenerationError';
  }

  get isExpired() {
    return this.status === 409 && /expir|expired/i.test(this.message);
  }
}

export function createRecipeGenerationIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.random() * 16 | 0;
    const value = char === 'x' ? random : (random & 0x3 | 0x8);
    return value.toString(16);
  });
}

function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message?: unknown }).message;
    if (Array.isArray(message)) return message.filter(item => typeof item === 'string').join(' ');
    if (typeof message === 'string') return message;
  }
  return fallback;
}

function toGenerationError(error: unknown, fallback: string): never {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    const code = data && typeof data === 'object' && typeof (data as { code?: unknown }).code === 'string'
      ? (data as { code: string }).code
      : undefined;
    throw new RecipeGenerationError(
      errorMessage(data, fallback),
      error.response?.status as RecipeGenerationErrorStatus,
      code,
      data,
    );
  }
  throw error;
}

export const recipeGenerationService = {
  async preview(
    payload: RecipeGenerationRequest,
    signal?: AbortSignal,
  ): Promise<RecipePreview> {
    try {
      const response = await apiClient.post<RecipePreview>('/ai/recipes/preview', payload, {
        headers: { 'Idempotency-Key': createRecipeGenerationIdempotencyKey() },
        timeout: 120_000,
        signal,
      });
      return response.data;
    } catch (error) {
      return toGenerationError(error, 'No pudimos generar una propuesta de recetas.');
    }
  },

  async confirm(
    generationRunId: string,
    draftIds: string[],
    signal?: AbortSignal,
    confirmationKey?: string,
  ): Promise<RecipeConfirmation> {
    try {
      const response = await apiClient.post<RecipeConfirmation>('/ai/recipes/confirm', {
        generationRunId,
        draftIds,
      }, {
        headers: { 'Idempotency-Key': confirmationKey ?? createRecipeGenerationIdempotencyKey() },
        timeout: 30_000,
        signal,
      });
      return response.data;
    } catch (error) {
      return toGenerationError(error, 'No pudimos guardar las recetas seleccionadas.');
    }
  },
};
