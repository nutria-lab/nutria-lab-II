import axios from 'axios';
import { apiClient } from './apiClient';

export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';

export type DayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

export type Ingredient = {
  name: string;
  quantity?: number;
  unit?: string;
};

export type Recipe = {
  id: string;
  title: string;
  description?: string;
  prepMinutes?: number;
  cookMinutes?: number;
  ingredients: Ingredient[];
  instructions: string[];
};

// Forma real de `PlannedMeal.nutritionalValues` (JSON), en PascalCase tal como lo expone
// el backend (ver plan.md sección 3) — no se renombra a camelCase en el frontend.
export type NutritionalValues = {
  Protein: number;
  Fiber: number;
  Calories: number;
  Description: string;
};

// `PlannedMeal` es el nombre real del contrato de backend; se mantiene `Meal` como alias
// para no romper los imports existentes de componentes que ya usan ese nombre.
export type PlannedMeal = {
  id: string;
  dayId: string;
  mealType: MealType;
  title: string;
  nutritionalValues: NutritionalValues;
  recipeId: string | null;
  recipe: Recipe | null;
};

export type Meal = PlannedMeal;

export type MealPlanDay = {
  id: string;
  mealPlanId: string;
  day: DayOfWeek;
  date: string;
  meals: PlannedMeal[];
};

export type MealPlan = {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
  days: MealPlanDay[];
};

const MEAL_PLAN_REQUEST_TIMEOUT_MS = 10_000;

// NUT-10 / Decisión 5 del design.md: un 401 debe ser distinguible de un error genérico
// para que `useMealPlan` pueda mapearlo a un estado `unauthorized` propio, en vez de caer
// en el mismo catch que un 500. Sigue el mismo patrón que `registerService.ts`
// (`RegisterRequestError`): clase de error propia + `skipAuthErrorHandling: true` para que
// el interceptor global de `apiClient.ts` no dispare también su propio redirect en paralelo.
export class MealPlanRequestError extends Error {
  constructor(public readonly kind: 'unauthorized') {
    super(kind);
    this.name = 'MealPlanRequestError';
  }
}

function rethrowAsUnauthorizedIfApplicable(error: unknown): never {
  if (axios.isAxiosError(error) && error.response?.status === 401) {
    throw new MealPlanRequestError('unauthorized');
  }
  throw error;
}

export const mealPlanService = {
  async getCurrentMealPlan(
    weekStart: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<MealPlan | null> {
    try {
      const response = await apiClient.get<MealPlan>('/meal-plans/current', {
        params: { weekStart },
        skipAuthErrorHandling: true,
        timeout: MEAL_PLAN_REQUEST_TIMEOUT_MS,
        signal,
      });
      const data = response.data;
      if (!data || !Array.isArray(data.days)) {
        throw new Error('La respuesta del servidor no tiene el formato esperado.');
      }
      // Normaliza `meals` por día: si algún día viene sin el array (o mal formado),
      // que se comporte como un día sin comidas en vez de romper a quien lo consuma.
      return {
        ...data,
        days: data.days.map((day) => ({
          ...day,
          meals: Array.isArray(day.meals) ? day.meals : [],
        })),
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      rethrowAsUnauthorizedIfApplicable(error);
    }
  },

  async generateMealPlan(
    weekStart: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<MealPlan | null> {
    try {
      const response = await apiClient.post<MealPlan>('/meal-plans/generate', { weekStart }, {
        skipAuthErrorHandling: true,
        timeout: MEAL_PLAN_REQUEST_TIMEOUT_MS,
        signal,
      });
      const data = response.data;
      if (!data || !Array.isArray(data.days)) {
        throw new Error('La respuesta del servidor no tiene el formato esperado.');
      }
      return {
        ...data,
        days: data.days.map((day) => ({
          ...day,
          meals: Array.isArray(day.meals) ? day.meals : [],
        })),
      };
    } catch (error) {
      rethrowAsUnauthorizedIfApplicable(error);
    }
  },
};
