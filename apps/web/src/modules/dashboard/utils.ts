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

// Glosario aprobado en NUT-93; debe moverse a un módulo compartido con NUT-93/NUT-94.
export const MEAL_STATUS_LABELS: Record<MealCompletionStatus, string> = {
  NOT_LOGGED: 'Sin registrar',
  COMPLETED: 'Completada',
  SKIPPED: 'Omitida',
};

// El backend puede enviar null o un estado nuevo: solo se aceptan las claves propias del mapa.
export function isKnownStatus(status: MealCompletionStatus | null): status is MealCompletionStatus {
  return status !== null && Object.hasOwn(MEAL_STATUS_LABELS, status);
}

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
  return meals.some((meal) => !isKnownStatus(meal.status));
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
  return isKnownStatus(status) ? MEAL_STATUS_LABELS[status] : null;
}

export function buildUnavailableViewModel(userName: string | null): DashboardViewModel {
  return {
    userName,
    todayMeals: { kind: 'unavailable' },
    adherence: { data: null, loading: false, error: null, onRetry: () => {} },
  };
}
