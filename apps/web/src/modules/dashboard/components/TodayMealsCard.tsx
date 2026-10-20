import { MEAL_TYPE_LABELS } from '@/modules/meal-plan/utils';
import { RecipeImage } from '@/modules/recipes/components/RecipeImage';

import type { CardState, TodayMeal, TodayMealsData } from '../types';
import { sortMealsByType } from '../utils';
import { CardError, CardNotice, CardSkeleton } from './CardStates';
import { MealStatusChip } from './MealStatusChip';

type Props = {
  state: CardState<TodayMealsData>;
  className?: string;
};

function TodayMealsList({ meals }: { meals: TodayMeal[] }) {
  const statusUnknown = meals.some((meal) => meal.status === null);
  return (
    <>
      {/* role="list" conserva la semántica en Safari con list-style none + grid. */}
      <ul role="list" className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {sortMealsByType(meals).map((meal) => (
          <li
            key={meal.plannedMealId}
            className="flex items-center gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-low p-3"
          >
            <RecipeImage image={null} title={meal.title} compact className="h-14 w-14 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                {MEAL_TYPE_LABELS[meal.mealType]}
              </p>
              <p className="truncate font-medium text-on-surface">{meal.title}</p>
            </div>
            {!statusUnknown && <MealStatusChip status={meal.status} />}
          </li>
        ))}
      </ul>
      {statusUnknown && (
        <p className="mt-3 text-sm text-on-surface-variant">El estado de registro no está disponible por ahora.</p>
      )}
    </>
  );
}

function TodayMealsBody({ state }: { state: CardState<TodayMealsData> }) {
  switch (state.kind) {
    case 'loading':
      return <CardSkeleton rows={4} />;
    case 'error':
      return <CardError message="No pudimos cargar tus comidas de hoy." retry={state.retry} />;
    case 'unavailable':
      return (
        <CardNotice
          icon="hourglass_empty"
          title="No disponible todavía"
          description="Pronto vas a ver aquí tus comidas del día."
        />
      );
    case 'ready':
      switch (state.data.kind) {
        case 'noPlan':
          return (
            <CardNotice
              icon="calendar_month"
              title="Todavía no tenés un plan para esta semana."
              action={{ label: 'Ir a mi plan', to: '/meal-plan' }}
            />
          );
        case 'noMealsToday':
          return (
            <CardNotice
              icon="event_busy"
              title="No hay comidas planificadas para hoy."
              action={{ label: 'Ver plan semanal', to: '/meal-plan' }}
            />
          );
        case 'meals':
          return <TodayMealsList meals={state.data.meals} />;
      }
  }
}

export function TodayMealsCard({ state, className = '' }: Props) {
  return (
    <section aria-labelledby="dashboard-today-meals-title" className={`rounded-xl bg-surface-container p-6 ${className}`}>
      <h2 id="dashboard-today-meals-title" className="mb-4 font-headline text-xl font-semibold text-on-surface">
        Comidas de hoy
      </h2>
      <TodayMealsBody state={state} />
    </section>
  );
}
