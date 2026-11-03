import { toPublicRecipeImage } from '@/modules/unsplash/unsplash.service';
import type { PersistedRecipeImage } from '@/modules/unsplash/recipe-image.types';
import { orderMealPlanDays } from '../../utils/meal-plan-order.util';

type MealPlanResponseMeal = { id: string; mealType: string; recipe?: any };
type MealPlanResponseDay = { id: string; date: Date | string; meals?: MealPlanResponseMeal[] | null };

// Plan tal como se devuelve al cliente: se quita la metadata privada de tracking de cada imagen (NUT-83).
export function toPublicMealPlan<T extends { days?: unknown[] | null }>(plan: T) {
  return {
    ...plan,
    days: orderMealPlanDays((plan.days ?? []) as MealPlanResponseDay[]).map((day) => ({
      ...day,
      meals: day.meals.map((meal) => {
        if (!meal.recipe) {
          return meal;
        }
        return {
          ...meal,
          recipe: { ...meal.recipe, image: toPublicRecipeImage(meal.recipe.image as PersistedRecipeImage | null) },
        };
      }),
    })),
  };
}
