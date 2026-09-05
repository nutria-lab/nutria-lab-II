import axios from 'axios';
import { http } from './http';

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
      const response = await http.get<MealPlan>('/meal-plans/current', {
        params: { weekStart },
      });
      const data = response.data;
      if (!data || !Array.isArray(data.days)) {
        throw new Error('La respuesta del servidor no tiene el formato esperado.');
      }
      return data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  },
};
