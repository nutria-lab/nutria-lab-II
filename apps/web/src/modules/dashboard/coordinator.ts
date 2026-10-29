import type { MealPlan } from '../../services/mealPlanService';
import type { AdherenceWidgetViewProps } from './adherence-widget/utils';
import type {
  AdherenceResponse,
  CardState,
  DashboardViewModel,
  ShoppingProgress,
  TodayMeal,
  TodayMealsData,
} from './types';
import { isKnownMealType, selectTodayMeals, sortMealsByType } from './utils';

// `unauthorized` = 401: la sesión global cierra la sesión y navega a /login. No es un error de tarjeta.
export type ResourceStatus = 'loading' | 'success' | 'error' | 'unauthorized';

// `data` está presente si hay una respuesta válida de la misma (usuario, semana), aunque haya un refresco
// en curso o fallido. Para el plan, `null` significa "sin plan" (404).
export type Resource<T> = { status: ResourceStatus; data?: T };

export type DashboardResources = {
  weekStart: string;
  // Fecha de hoy en Buenos Aires al pedir los datos; solo se usa si la adherencia no respondió.
  today: string;
  mealPlan: Resource<MealPlan | null>;
  adherence: Resource<AdherenceResponse>;
  shopping: Resource<ShoppingProgress>;
  // planId distinto entre respuestas aún después de la reconsulta acotada.
  conflict: boolean;
};

// Valores internos del widget: nunca se muestran (la UI usa copy fijo).
export const ADHERENCE_UNAVAILABLE_ERROR = 'ADHERENCE_UNAVAILABLE';
export const PLAN_CONFLICT_ERROR = 'PLAN_CONFLICT';

export function createLoadingResources(weekStart: string, today: string): DashboardResources {
  return {
    weekStart,
    today,
    mealPlan: { status: 'loading' },
    adherence: { status: 'loading' },
    shopping: { status: 'loading' },
    conflict: false,
  };
}

// Versión del plan a la que pertenece cada respuesta; `null` = sin plan.
export const planIdOf = {
  mealPlan: (data: MealPlan | null): string | null => data?.id ?? null,
  adherence: (data: AdherenceResponse): string | null => data.plan?.id ?? null,
  shopping: (data: ShoppingProgress): string | null => data.plan?.id ?? null,
};

export type ResourceData = {
  mealPlan?: MealPlan | null;
  adherence?: AdherenceResponse;
  shopping?: ShoppingProgress;
};

// Un recurso sin datos no participa; "sin plan" (null) sí, porque contradice a una respuesta con plan.
export function planIdsOf(data: ResourceData): Array<string | null> {
  const ids: Array<string | null> = [];
  if (data.mealPlan !== undefined) ids.push(planIdOf.mealPlan(data.mealPlan));
  if (data.adherence !== undefined) ids.push(planIdOf.adherence(data.adherence));
  if (data.shopping !== undefined) ids.push(planIdOf.shopping(data.shopping));
  return ids;
}

export function hasPlanConflict(data: ResourceData): boolean {
  return new Set(planIdsOf(data)).size > 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlannedMeal(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.mealType === 'string' &&
    typeof value.title === 'string' &&
    (typeof value.recipeId === 'string' || value.recipeId === null) &&
    (value.recipe === null || value.recipe === undefined || isRecord(value.recipe))
  );
}

// El servicio del planificador (sin cambios) solo garantiza `days` como array. Lo que el Inicio lee del
// plan se valida acá: una respuesta de otra semana o con una comida mal formada es un error recuperable,
// nunca "hoy no hay comidas" ni un fallo de render.
export function isUsableMealPlan(plan: MealPlan, weekStart: string): boolean {
  return (
    typeof plan.id === 'string' &&
    typeof plan.startDate === 'string' &&
    plan.startDate.slice(0, 10) === weekStart &&
    plan.days.every(
      (day) => isRecord(day) && typeof day.date === 'string' && Array.isArray(day.meals) && day.meals.every(isPlannedMeal),
    )
  );
}

function imagesByMealId(plan: MealPlan): Map<string, TodayMeal['image']> {
  return new Map(plan.days.flatMap((day) => day.meals.map((meal) => [meal.id, meal.recipe?.image ?? null] as const)));
}

// Sin adherencia: las comidas de hoy salen del plan, sin estado de registro (la tarjeta muestra la nota fija).
function todayMealsFromPlan(plan: MealPlan, today: string, retry: () => void): CardState<TodayMealsData> {
  const meals = plan.days.find((day) => day.date === today)?.meals ?? [];
  if (meals.some((meal) => !isKnownMealType(meal.mealType))) return { kind: 'error', retry };
  if (meals.length === 0) return { kind: 'ready', data: { kind: 'noMealsToday' } };
  const todayMeals: TodayMeal[] = meals.map((meal) => ({
    plannedMealId: meal.id,
    mealType: meal.mealType,
    title: meal.title,
    recipeId: meal.recipeId,
    status: null,
    image: meal.recipe?.image ?? null,
  }));
  return { kind: 'ready', data: { kind: 'meals', meals: sortMealsByType(todayMeals) } };
}

function buildTodayMeals(resources: DashboardResources, retry: () => void): CardState<TodayMealsData> {
  const { mealPlan, adherence } = resources;
  if (resources.conflict) return { kind: 'error', retry };
  if (mealPlan.data === undefined) {
    if (mealPlan.status === 'unauthorized') return { kind: 'unavailable' };
    if (mealPlan.status === 'loading') return { kind: 'loading' };
    // Un 500 o una respuesta inválida nunca se presenta como "sin plan".
    return { kind: 'error', retry };
  }
  if (mealPlan.data === null) return { kind: 'ready', data: { kind: 'noPlan' } };

  if (adherence.data !== undefined) {
    const data = selectTodayMeals(adherence.data);
    if (data.kind !== 'meals') return { kind: 'ready', data };
    const images = imagesByMealId(mealPlan.data);
    const meals = data.meals.map((meal) => ({ ...meal, image: images.get(meal.plannedMealId) ?? null }));
    return { kind: 'ready', data: { kind: 'meals', meals } };
  }
  if (adherence.status === 'loading') return { kind: 'loading' };
  return todayMealsFromPlan(mealPlan.data, resources.today, retry);
}

function buildAdherence(resources: DashboardResources, retry: () => void): AdherenceWidgetViewProps {
  const { adherence, mealPlan, weekStart } = resources;
  const base = { onRetry: retry, expectedWeekStart: weekStart };
  if (resources.conflict) return { ...base, data: null, loading: false, error: PLAN_CONFLICT_ERROR };
  // 401: ni carga ni error; el widget muestra "No disponible todavía" hasta que la sesión redirige.
  if (adherence.status === 'unauthorized') return { ...base, data: null, loading: false, error: null };
  return {
    ...base,
    data: adherence.data ?? null,
    loading: adherence.status === 'loading',
    error: adherence.status === 'error' ? ADHERENCE_UNAVAILABLE_ERROR : null,
    // Sin respuesta del plan no hay contra qué comparar.
    expectedPlanId: mealPlan.data === undefined ? undefined : (mealPlan.data?.id ?? null),
  };
}

function buildShopping(resources: DashboardResources, retry: () => void): CardState<ShoppingProgress> {
  const { shopping } = resources;
  if (resources.conflict || shopping.status === 'error') return { kind: 'error', retry };
  if (shopping.status === 'unauthorized') return { kind: 'unavailable' };
  if (shopping.data !== undefined) return { kind: 'ready', data: shopping.data };
  return { kind: 'loading' };
}

export function buildDashboardViewModel(
  resources: DashboardResources,
  userName: string | null,
  retry: () => void,
): DashboardViewModel {
  return {
    userName,
    todayMeals: buildTodayMeals(resources, retry),
    adherence: buildAdherence(resources, retry),
    shopping: buildShopping(resources, retry),
  };
}
