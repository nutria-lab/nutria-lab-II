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

  // La imagen sale sólo de la siguiente comida y se omite (sin placeholder) si el dato no la trae.
  const image = next.image ?? null;

  return (
    <section aria-labelledby="dashboard-next-meal-title" className={`flex flex-col gap-3 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="dashboard-next-meal-title" className="font-headline text-xl font-semibold text-on-surface">
          Siguiente comida por registrar
        </h2>
        <span className="shrink-0 rounded-full bg-brand-green px-3 py-1 text-xs font-bold uppercase tracking-wider text-on-primary">
          {MEAL_TYPE_LABELS[next.mealType]}
        </span>
      </div>
      <div className="flex flex-col overflow-hidden rounded-xl bg-white shadow-[0_4px_20px_rgba(46,50,48,0.08)] md:flex-row">
        {image && <RecipeImage image={image} title={next.title} className="h-56 md:h-auto md:min-h-64 md:w-1/2" />}
        <div className={`flex flex-col gap-3 p-6 md:justify-center ${image ? 'md:w-1/2' : ''}`}>
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
      </div>
    </section>
  );
}
