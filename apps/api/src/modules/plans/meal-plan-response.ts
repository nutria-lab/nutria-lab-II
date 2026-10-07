import { toPublicRecipeImage } from '@/modules/unsplash/unsplash.service';
import type { PersistedRecipeImage } from '@/modules/unsplash/recipe-image.types';

// Plan tal como se devuelve al cliente: se quita la metadata privada de tracking de cada imagen (NUT-83).
export function toPublicMealPlan<T extends { days?: unknown[] | null }>(plan: T) {
  return {
    ...plan,
    days: (plan.days ?? []).map((day: any) => ({
      ...day,
      meals: (day.meals ?? []).map((meal: any) => {
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
