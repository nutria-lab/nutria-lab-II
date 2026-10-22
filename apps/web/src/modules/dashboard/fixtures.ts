import type { AdherenceWidgetProps } from './adherence-widget/types';
import type { AdherenceResponse, DashboardViewModel, TodayMeal } from './types';

// Solo desarrollo. La cadena centinela va dentro de los datos para poder
// verificar en el build de producción que este módulo no quedó incluido.
export const DASHBOARD_FIXTURE_SENTINEL = 'nut95-dashboard-fixture-sentinel';

export type DashboardFixtureKey =
  | 'loading'
  | 'sin-plan'
  | 'sin-comidas'
  | 'comidas'
  | 'todo-registrado'
  | 'error'
  | 'error-parcial'
  | 'no-disponible'
  | 'sin-nombre';

type DashboardFixture = Omit<DashboardViewModel, 'userName'> & { userName?: null };

function fixtureId(suffix: string): string {
  return `${DASHBOARD_FIXTURE_SENTINEL}-${suffix}`;
}

// Desordenadas a propósito: la vista es la que ordena.
const MIXED_MEALS: TodayMeal[] = [
  { plannedMealId: fixtureId('dinner'), mealType: 'DINNER', title: 'Receta de ejemplo 4', recipeId: null, status: 'NOT_LOGGED' },
  { plannedMealId: fixtureId('breakfast'), mealType: 'BREAKFAST', title: 'Receta de ejemplo 1', recipeId: 'recipe-example-1', status: 'COMPLETED' },
  { plannedMealId: fixtureId('snack'), mealType: 'SNACK', title: 'Receta de ejemplo 3', recipeId: 'recipe-example-3', status: 'SKIPPED' },
  { plannedMealId: fixtureId('lunch'), mealType: 'LUNCH', title: 'Receta de ejemplo 2', recipeId: 'recipe-example-2', status: 'NOT_LOGGED' },
];

const ALL_LOGGED_MEALS: TodayMeal[] = MIXED_MEALS.map((meal) => ({
  ...meal,
  status: meal.mealType === 'SNACK' ? 'SKIPPED' : 'COMPLETED',
}));

const UNKNOWN_STATUS_MEALS: TodayMeal[] = MIXED_MEALS.map((meal) => ({ ...meal, status: null }));

// El retry se inyecta al seleccionar el fixture para que la página controle el flujo de recuperación.
type FixtureBuilder = (onRetry: () => void) => DashboardFixture;

const readyAdherence = (onRetry: () => void): AdherenceWidgetProps => ({
  data: adherenceResponseFixture,
  loading: false,
  error: null,
  onRetry,
});

// Texto interno de ejemplo: el slot nunca lo muestra (copy fijo) y no lleva dígitos ni "%".
const failedAdherence = (onRetry: () => void): AdherenceWidgetProps => ({
  data: null,
  loading: false,
  error: 'No se pudo obtener el progreso.',
  onRetry,
});

export const DASHBOARD_FIXTURES: Record<DashboardFixtureKey, FixtureBuilder> = {
  loading: (onRetry) => ({
    todayMeals: { kind: 'loading' },
    adherence: { data: null, loading: true, error: null, onRetry },
  }),
  'sin-plan': (onRetry) => ({
    todayMeals: { kind: 'ready', data: { kind: 'noPlan' } },
    adherence: readyAdherence(onRetry),
  }),
  'sin-comidas': (onRetry) => ({
    todayMeals: { kind: 'ready', data: { kind: 'noMealsToday' } },
    adherence: readyAdherence(onRetry),
  }),
  comidas: (onRetry) => ({
    todayMeals: { kind: 'ready', data: { kind: 'meals', meals: MIXED_MEALS } },
    adherence: readyAdherence(onRetry),
  }),
  'todo-registrado': (onRetry) => ({
    todayMeals: { kind: 'ready', data: { kind: 'meals', meals: ALL_LOGGED_MEALS } },
    adherence: readyAdherence(onRetry),
  }),
  error: (onRetry) => ({
    todayMeals: { kind: 'error', retry: onRetry },
    adherence: failedAdherence(onRetry),
  }),
  'error-parcial': (onRetry) => ({
    todayMeals: { kind: 'ready', data: { kind: 'meals', meals: UNKNOWN_STATUS_MEALS } },
    adherence: failedAdherence(onRetry),
  }),
  'no-disponible': (onRetry) => ({
    todayMeals: { kind: 'unavailable' },
    adherence: { data: null, loading: false, error: null, onRetry },
  }),
  'sin-nombre': (onRetry) => ({
    userName: null,
    todayMeals: { kind: 'ready', data: { kind: 'meals', meals: MIXED_MEALS } },
    adherence: readyAdherence(onRetry),
  }),
};

// Valida el contrato de adherencia; nunca se renderiza.
export const adherenceResponseFixture: AdherenceResponse = {
  weekStart: '2026-10-19',
  timezone: 'America/Argentina/Buenos_Aires',
  today: '2026-10-19',
  plan: { id: fixtureId('plan'), version: 1, updatedAt: '2026-10-19T09:00:00.000Z' },
  days: [
    {
      date: '2026-10-19',
      plannedMeals: 4,
      completedMeals: 1,
      skippedMeals: 1,
      notLoggedMeals: 2,
      adherencePercent: null,
      meals: MIXED_MEALS.map((meal) => ({
        plannedMealId: meal.plannedMealId,
        mealUpdatedAt: '2026-10-19T09:00:00.000Z',
        recipeId: meal.recipeId,
        mealType: meal.mealType,
        title: meal.title,
        status: meal.status ?? 'NOT_LOGGED',
        canEdit: true,
      })),
    },
  ],
  summary: { plannedMeals: 4, completedMeals: 1, skippedMeals: 1, notLoggedMeals: 2, adherencePercent: null },
};

function isFixtureKey(key: string | null): key is DashboardFixtureKey {
  return key !== null && Object.prototype.hasOwnProperty.call(DASHBOARD_FIXTURES, key);
}

// Devuelve null ante una clave desconocida: la página muestra el estado no disponible.
export function selectDashboardFixture(
  key: string | null,
  userName: string | null,
  onRetry: () => void,
): DashboardViewModel | null {
  if (!isFixtureKey(key)) return null;
  const fixture = DASHBOARD_FIXTURES[key](onRetry);
  return {
    userName: fixture.userName === null ? null : userName,
    todayMeals: fixture.todayMeals,
    adherence: fixture.adherence,
  };
}
