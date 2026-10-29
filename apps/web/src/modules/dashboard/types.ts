import type { MealType } from '../../services/mealPlanService';
import type { RecipeImage } from '../../services/recipeService';
import type { AdherenceResponse, MealCompletionStatus } from '../adherence/types';
import type { ShoppingListResponse } from '../shopping-list/types';
import type { AdherenceWidgetViewProps } from './adherence-widget/utils';

// Contrato A: un único modelo, el del módulo de adherencia.
export type { AdherenceMeal, AdherenceResponse, MealCompletionStatus } from '../adherence/types';
export type AdherenceDay = AdherenceResponse['days'][number];

// Parte del contrato C que usa el Inicio: los contadores vienen del servidor y no se recalculan.
export type ShoppingProgress = Pick<ShoppingListResponse, 'weekStart' | 'plan' | 'summary'>;

export type CardState<T> =
  | { kind: 'loading' }
  // Todo error es recuperable y el copy lo fija cada tarjeta: no se exponen mensajes externos.
  | { kind: 'error'; retry: () => void }
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
  adherence: AdherenceWidgetViewProps;
  shopping: CardState<ShoppingProgress>;
};
