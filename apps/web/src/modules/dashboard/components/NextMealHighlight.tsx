import { Link } from 'react-router-dom';

import { MEAL_TYPE_LABELS } from '@/modules/meal-plan/utils';
import { RecipeImage } from '@/modules/recipes/components/RecipeImage';

import type { CardState, TodayMeal, TodayMealsData } from '../types';
import { nextMealToLog } from '../utils';
import { CardSkeleton, PRIMARY_CTA_CLASSES } from './CardStates';

type Props = {
  state: CardState<TodayMealsData>;
  className?: string;
};

// Sin estado de registro conocido (error parcial) no se resalta ninguna comida.
function mealsWithKnownStatus(state: CardState<TodayMealsData>): TodayMeal[] | null {
  if (state.kind !== 'ready' || state.data.kind !== 'meals') return null;
  const { meals } = state.data;
  if (meals.length === 0 || meals.some((meal) => meal.status === null)) return null;
  return meals;
}

export function hasNextMealColumn(state: CardState<TodayMealsData>): boolean {
  return state.kind === 'loading' || mealsWithKnownStatus(state) !== null;
}

export function NextMealHighlight({ state, className = '' }: Props) {
  if (state.kind === 'loading') {
    return (
      <div className={`rounded-xl bg-surface-container-low p-6 ${className}`}>
        <CardSkeleton rows={3} />
      </div>
    );
  }

  const meals = mealsWithKnownStatus(state);
  if (!meals) return null;

  const next = nextMealToLog(meals);
  if (!next) {
    return (
      <div className={`flex items-center gap-4 rounded-xl bg-surface-container-low p-6 ${className}`}>
        <span aria-hidden="true" className="material-symbols-outlined text-3xl text-brand-green">
          task_alt
        </span>
        <p className="font-headline text-lg font-semibold text-on-surface">Ya registraste todas las comidas de hoy.</p>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="dashboard-next-meal-title"
      className={`flex flex-col overflow-hidden rounded-xl bg-surface-container-low md:flex-row ${className}`}
    >
      <RecipeImage image={null} title={next.title} className="h-56 md:h-auto md:min-h-64 md:w-1/2" />
      <div className="flex flex-col gap-3 p-6 md:w-1/2 md:justify-center">
        <h2 id="dashboard-next-meal-title" className="text-sm font-semibold text-on-surface-variant">
          Siguiente comida por registrar
        </h2>
        <span className="w-fit rounded-full bg-tertiary-fixed px-3 py-1 text-xs font-bold text-on-surface">
          {MEAL_TYPE_LABELS[next.mealType]}
        </span>
        <p className="font-headline text-2xl font-bold text-on-surface">{next.title}</p>
        {next.recipeId && (
          <Link to={`/recipes/${next.recipeId}`} className={`mt-2 w-fit ${PRIMARY_CTA_CLASSES}`}>
            Ver receta
            <span aria-hidden="true" className="material-symbols-outlined text-lg">
              arrow_forward
            </span>
          </Link>
        )}
      </div>
    </section>
  );
}
