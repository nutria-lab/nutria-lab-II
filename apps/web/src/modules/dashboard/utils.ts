import type { MealType } from '../../services/mealPlanService';

import type {
  AdherenceResponse,
  CardState,
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

export function hasUnknownStatus(meals: readonly TodayMeal[]): boolean {
  return meals.some((meal) => meal.status === null);
}

// La siguiente comida es la primera pendiente en orden fijo, no según la hora del día.
// Sin estado de registro conocido (error parcial) no se resalta ninguna comida.
export function nextMealToLog(meals: readonly TodayMeal[]): TodayMeal | null {
  if (hasUnknownStatus(meals)) return null;
  return sortMealsByType(meals).find((meal) => meal.status === 'NOT_LOGGED') ?? null;
}

// La columna de siguiente comida existe mientras carga o cuando hay comidas con estado conocido
// (pendiente o todo registrado); en cualquier otro caso el progreso ocupa todo el ancho.
export function hasNextMealColumn(state: CardState<TodayMealsData>): boolean {
  if (state.kind === 'loading') return true;
  if (state.kind !== 'ready' || state.data.kind !== 'meals') return false;
  const { meals } = state.data;
  return meals.length > 0 && !hasUnknownStatus(meals);
}

export function buildGreeting(name: string | null | undefined): string {
  const firstName = name?.trim().split(/\s+/)[0];
  return firstName ? `Hola, ${firstName}` : 'Hola';
}

export function getMealStatusLabel(status: MealCompletionStatus | null): string | null {
  // El backend puede enviar un estado nuevo: solo se aceptan las claves propias del mapa.
  if (status === null || !Object.hasOwn(MEAL_STATUS_LABELS, status)) return null;
  return MEAL_STATUS_LABELS[status];
}

export function buildUnavailableViewModel(userName: string | null): DashboardViewModel {
  return {
    userName,
    todayMeals: { kind: 'unavailable' },
    adherence: { kind: 'unavailable' },
  };
}
