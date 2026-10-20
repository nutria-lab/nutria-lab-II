import { Link } from 'react-router-dom';

import { MEAL_TYPE_LABELS } from '../../meal-plan/utils';
import { RecipeImage } from '../../recipes/components/RecipeImage';
import type { CardState, TodayMealsData } from '../types';
import { hasNextMealColumn, nextMealToLog } from '../utils';
import { CardSkeleton } from './CardStates';
import { PRIMARY_CTA_CLASSES } from './classNames';

type Props = {
  state: CardState<TodayMealsData>;
  className?: string;
};

export function NextMealHighlight({ state, className = '' }: Props) {
  if (state.kind === 'loading') {
    return (
      <div className={`rounded-xl bg-surface-container-low p-6 ${className}`}>
        <CardSkeleton rows={3} />
      </div>
    );
  }

  // Sin lista o con algún estado desconocido no hay columna ni resaltado.
  if (!hasNextMealColumn(state) || state.kind !== 'ready' || state.data.kind !== 'meals') return null;

  const next = nextMealToLog(state.data.meals);
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
