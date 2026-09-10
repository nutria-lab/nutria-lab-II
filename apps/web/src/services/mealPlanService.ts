import axios from 'axios';
import { apiClient } from './apiClient';

export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';

export type Ingredient = {
  name: string;
  quantity?: number;
  unit?: string;
};

export type Recipe = {
  title: string;
  description?: string;
  prepMinutes?: number;
  cookMinutes?: number;
  ingredients: Ingredient[];
  instructions: string[];
};

export type Meal = {
  mealType: MealType;
  servings?: number;
  recipe: Recipe;
};

export type MealPlanDay = {
  date: string;
  meals: Meal[];
};

export type MealPlan = {
  id: string;
  weekStart: string;
  days: MealPlanDay[];
};

export const mealPlanService = {
  async getCurrentMealPlan(weekStart: string): Promise<MealPlan | null> {
    try {
      const response = await apiClient.get<MealPlan>('/meal-plans/current', {
        params: { weekStart },
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
      throw error;
    }
  },
};
