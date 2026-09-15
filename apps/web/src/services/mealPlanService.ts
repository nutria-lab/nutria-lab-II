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
// NUT-10 (sexta iteración) — Observación 3 del revisor externo: la generación dispara una
// llamada a Gemini del lado del backend que puede tardar hasta 15s y sigue corriendo en el
// servidor aunque el cliente aborte antes. Se le da un timeout propio, mayor a 15s, distinto
// del que usa `getCurrentMealPlan` (consultar el plan actual es una operación rápida).
const MEAL_PLAN_GENERATION_TIMEOUT_MS = 20_000;

export const mealPlanService = {
  async getCurrentMealPlan(
    weekStart: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<MealPlan | null> {
    try {
      const response = await apiClient.get<MealPlan>('/meal-plans/current', {
        params: { weekStart },
        timeout: MEAL_PLAN_REQUEST_TIMEOUT_MS,
        signal,
      });
      const data = response.data;
      if (!data || !Array.isArray(data.days)) {
        throw new Error('La respuesta del servidor no tiene el formato esperado.');
      }
      // Normaliza por día: si algún día viene sin `meals` (o mal formado), que se comporte
      // como un día sin comidas en vez de romper a quien lo consuma. También normaliza
      // `date` de datetime ISO completo (`'2026-08-24T00:00:00.000Z'`) a `'YYYY-MM-DD'`: el
      // prefijo de 10 caracteres de un ISO UTC-medianoche ya es la fecha calendario correcta.
      return {
        ...data,
        days: data.days.map((day) => ({
          ...day,
          date: day.date.slice(0, 10),
          meals: Array.isArray(day.meals) ? day.meals : [],
        })),
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  },

  async generateMealPlan(
    weekStart: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<MealPlan | null> {
    const response = await apiClient.post<MealPlan>('/meal-plans/generate', { weekStart }, {
      timeout: MEAL_PLAN_GENERATION_TIMEOUT_MS,
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
        date: day.date.slice(0, 10),
        meals: Array.isArray(day.meals) ? day.meals : [],
      })),
    };
  },
};
