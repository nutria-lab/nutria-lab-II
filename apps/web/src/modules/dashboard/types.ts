import type { MealType } from '../../services/mealPlanService';
import type { RecipeImage } from '../../services/recipeService';

export type MealCompletionStatus = 'NOT_LOGGED' | 'COMPLETED' | 'SKIPPED';

export type AdherenceMeal = {
  plannedMealId: string;
  mealUpdatedAt: string;
  recipeId: string | null;
  mealType: MealType;
  title: string;
  status: MealCompletionStatus;
  canEdit: boolean;
};

export type AdherenceDay = {
  date: string;
  plannedMeals: number;
  completedMeals: number;
  skippedMeals: number;
  notLoggedMeals: number;
  adherencePercent: number | null;
  meals: AdherenceMeal[];
};

export type AdherenceResponse = {
  weekStart: string;
  timezone: 'America/Argentina/Buenos_Aires';
  today: string;
  plan: { id: string; version: number; updatedAt: string } | null;
  days: AdherenceDay[];
  summary: {
    plannedMeals: number;
    completedMeals: number;
    skippedMeals: number;
    notLoggedMeals: number;
    adherencePercent: number | null;
  };
};

export type CardState<T> =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; retry?: () => void }
  | { kind: 'unavailable' }
  | { kind: 'ready'; data: T };

export type TodayMeal = {
  plannedMealId: string;
  mealType: MealType;
  title: string;
  recipeId: string | null;
  status: MealCompletionStatus | null;
  // Opcional porque el contrato A no la incluye; se completa cuando la fuente de datos la provee.
  image?: RecipeImage | null;
};

export type TodayMealsData =
  | { kind: 'noPlan' }
  | { kind: 'noMealsToday' }
  | { kind: 'meals'; meals: TodayMeal[] };

export type DashboardViewModel = {
  userName: string | null;
  todayMeals: CardState<TodayMealsData>;
  // El slot de adherencia solo usa `kind`: ningún valor de progreso llega a la UI todavía.
  adherence: CardState<null>;
};
