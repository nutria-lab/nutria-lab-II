import { MEAL_TYPE_LABELS } from '../../meal-plan/utils';
import { RecipeImage } from '../../recipes/components/RecipeImage';
import type { CardState, TodayMeal, TodayMealsData } from '../types';
import { hasUnknownStatus, sortMealsByType } from '../utils';
import { CardError, CardNotice, CardSkeleton } from './CardStates';
import { MealStatusChip } from './MealStatusChip';

type Props = {
  state: CardState<TodayMealsData>;
  className?: string;
};

function NoMealsTodayNotice() {
  return (
    <CardNotice
      icon="event_busy"
      title="No hay comidas planificadas para hoy."
      action={{ label: 'Ver plan semanal', to: '/meal-plan' }}
    />
  );
}

function TodayMealsList({ meals }: { meals: TodayMeal[] }) {
  const statusUnknown = hasUnknownStatus(meals);
  return (
    <>
      {/* role="list" conserva la semántica en Safari con list-style none + grid. */}
      <ul role="list" className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-2">
        {sortMealsByType(meals).map((meal) => (
          <li
            key={meal.plannedMealId}
            className="flex items-center gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-low p-3"
          >
            {/* La miniatura se omite (sin placeholder) si la comida no trae imagen. */}
            {meal.image && (
              <RecipeImage image={meal.image} title={meal.title} compact className="h-14 w-14 shrink-0 rounded-lg" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                {MEAL_TYPE_LABELS[meal.mealType]}
              </p>
              <p className="line-clamp-2 break-words font-medium text-on-surface">{meal.title}</p>
              {!statusUnknown && (
                <div className="mt-1">
                  <MealStatusChip status={meal.status} />
                </div>
              )}
            </div>
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
          return <NoMealsTodayNotice />;
        case 'meals':
          // Una lista vacía equivale a no tener comidas hoy: nunca se muestra una lista vacía.
          return state.data.meals.length === 0 ? <NoMealsTodayNotice /> : <TodayMealsList meals={state.data.meals} />;
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
