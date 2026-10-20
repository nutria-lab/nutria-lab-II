import type { MealType } from '@/services/mealPlanService';

import type {
  AdherenceResponse,
  DashboardViewModel,
  MealCompletionStatus,
  TodayMeal,
  TodayMealsData,
} from './types';

// Orden explícito del día: el union MealType declara DINNER antes que SNACK,
// así que no se puede derivar de ahí.
export const MEAL_TYPE_ORDER: readonly MealType[] = ['BREAKFAST', 'LUNCH', 'SNACK', 'DINNER'];

export const MEAL_STATUS_LABELS: Record<MealCompletionStatus, string> = {
  NOT_LOGGED: 'Pendiente',
  COMPLETED: 'Registrada',
  SKIPPED: 'Salteada',
};

export function sortMealsByType(meals: readonly TodayMeal[]): TodayMeal[] {
  return [...meals].sort(
    (a, b) => MEAL_TYPE_ORDER.indexOf(a.mealType) - MEAL_TYPE_ORDER.indexOf(b.mealType),
  );
}

// "Hoy" lo define el backend (`today`, zona Buenos Aires): se compara como string
// y nunca se consulta el reloj ni la zona del navegador.
export function selectTodayMeals(adherence: AdherenceResponse): TodayMealsData {
  if (adherence.plan === null) {
    return { kind: 'noPlan' };
  }
  const today = adherence.days.find((day) => day.date === adherence.today);
  if (!today || today.meals.length === 0) {
    return { kind: 'noMealsToday' };
  }
  const meals = today.meals.map(({ plannedMealId, mealType, title, recipeId, status }) => ({
    plannedMealId,
    mealType,
    title,
    recipeId,
    status,
  }));
  return { kind: 'meals', meals: sortMealsByType(meals) };
}

// La siguiente comida es la primera pendiente en orden fijo, no según la hora del día.
export function nextMealToLog(meals: readonly TodayMeal[]): TodayMeal | null {
  return sortMealsByType(meals).find((meal) => meal.status === 'NOT_LOGGED') ?? null;
}

export function buildGreeting(name: string | null | undefined): string {
  const firstName = name?.trim().split(/\s+/)[0];
  return firstName ? `Hola, ${firstName}` : 'Hola';
}

export function getMealStatusLabel(status: MealCompletionStatus | null): string | null {
  return status === null ? null : MEAL_STATUS_LABELS[status];
}

export function buildUnavailableViewModel(userName: string | null): DashboardViewModel {
  return {
    userName,
    todayMeals: { kind: 'unavailable' },
    adherence: { kind: 'unavailable' },
  };
}
