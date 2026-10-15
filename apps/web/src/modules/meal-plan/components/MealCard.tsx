import { useState } from 'react';
import type { Meal } from '../../../services/mealPlanService';
import { MEAL_TYPE_LABELS, formatIngredient } from '../utils';
import { MealCardErrorBanner } from './MealCardErrorBanner';
import { MealCardLoadingOverlay } from './MealCardLoadingOverlay';
import { MealCardMobileConfirm } from './MealCardMobileConfirm';
import { RecipeImage } from '../../recipes/components/RecipeImage';

const MEAL_TYPE_BADGE: Record<string, { bg: string; text: string }> = {
  BREAKFAST: { bg: 'bg-tertiary-fixed/40', text: 'text-on-tertiary-container' },
  LUNCH:     { bg: 'bg-primary-fixed/50', text: 'text-brand-green-dark' },
  DINNER:    { bg: 'bg-secondary-container', text: 'text-on-secondary-container' },
  SNACK:     { bg: 'bg-surface-container-highest', text: 'text-on-surface-variant' },
};

function MealTypeBadge({ mealType }: { mealType: string }) {
  const style = MEAL_TYPE_BADGE[mealType] ?? MEAL_TYPE_BADGE.SNACK;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${style.bg} ${style.text}`}
    >
      {MEAL_TYPE_LABELS[mealType as keyof typeof MEAL_TYPE_LABELS] ?? mealType}
    </span>
  );
}

export type MealCardReplaceError = {
  message: string;
  onRetry: () => void;
  onCancel: () => void;
};

type MealCardProps = {
  meal: Meal;
  compact?: boolean;
  onSwap?: (meal: Meal) => void;
  onReplace?: (meal: Meal) => void;
  isReplacing?: boolean;
  replaceError?: MealCardReplaceError | null;
};

export function MealCard({
  meal,
  compact = false,
  onSwap,
  onReplace,
  isReplacing = false,
  replaceError = null,
}: MealCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isConfirmingMobile, setIsConfirmingMobile] = useState(false);
  const { recipe } = meal;

  const totalMinutes = recipe
    ? (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0) || null
    : null;
  const calories = meal.nutritionalValues?.Calories;
  const protein = meal.nutritionalValues?.Protein;

  const handleTriggerReplace = () => {
    if (onReplace) {
      onReplace(meal);
    } else if (onSwap) {
      onSwap(meal);
    }
  };

  if (compact) {
    return (
      <article
        aria-busy={isReplacing}
        className="relative flex flex-col gap-2 rounded-xl bg-white p-2.5 shadow-sm border border-outline-variant/30 hover:border-brand-green/30 transition-all"
      >
        {isReplacing && <MealCardLoadingOverlay compact />}

        <div className="flex items-center justify-between">
          <MealTypeBadge mealType={meal.mealType} />
          <button
            type="button"
            disabled={isReplacing}
            aria-label={`Cambiar comida ${recipe?.title ?? ''}`.trim()}
            onClick={handleTriggerReplace}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-brand-green transition-colors disabled:opacity-40"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-sm">sync</span>
          </button>
        </div>
        <a href={'/recipes/' + (recipe?.id ?? '')} aria-label={'Ver receta ' + (recipe?.title ?? 'Receta no disponible')} className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-green"><RecipeImage image={recipe?.image} title={recipe?.title ?? 'Receta'} className="h-20 w-full rounded-lg" /><h4 className="mt-2 font-headline text-xs font-bold leading-tight line-clamp-2 text-on-surface">{recipe ? recipe.title : 'Receta no disponible'}</h4></a>
        {recipe && (
          <div className="mt-auto flex items-center gap-2 text-[10px] font-semibold text-on-surface-variant">
            {totalMinutes != null && (
              <span className="flex items-center gap-0.5">
                <span aria-hidden="true" className="material-symbols-outlined text-xs">schedule</span>
                {totalMinutes}m
              </span>
            )}
            {calories != null && (
              <span className="flex items-center gap-0.5 text-brand-green">
                <span aria-hidden="true" className="material-symbols-outlined text-xs">local_fire_department</span>
                {calories} kcal
              </span>
            )}
          </div>
        )}

        {replaceError && (
          <MealCardErrorBanner
            compact
            message={replaceError.message}
            onRetry={replaceError.onRetry}
            onCancel={replaceError.onCancel}
          />
        )}
      </article>
    );
  }

  if (!recipe) {
    return (
      <div className="flex items-center gap-4 rounded-xl bg-surface-container-low p-4">
        <div className="h-24 w-24 shrink-0 rounded-lg bg-surface-container" aria-hidden="true" />
        <div>
          <MealTypeBadge mealType={meal.mealType} />
          <p className="mt-1 font-headline text-base font-semibold text-on-surface-variant">
            Receta no disponible
          </p>
        </div>
      </div>
    );
  }

  const ingredients = recipe.ingredients ?? [];
  const instructions = recipe.instructions ?? [];

  return (
    <article
      aria-busy={isReplacing}
      className="relative overflow-hidden rounded-xl bg-white shadow-[0_4px_20px_rgba(46,50,48,0.06)] border border-outline-variant/30 transition-shadow hover:shadow-md"
    >
      {isReplacing && <MealCardLoadingOverlay />}

      {/* Main card body */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <MealTypeBadge mealType={meal.mealType} />
          <button
            type="button"
            disabled={isReplacing}
            aria-label={`Reemplazar comida ${recipe.title}`}
            onClick={() => setIsConfirmingMobile((prev) => !prev)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-brand-green transition-colors disabled:opacity-40"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">sync</span>
          </button>
        </div>

        {/* Recipe link */}
        <a
          href={'/recipes/' + recipe.id}
          aria-label={'Ver receta ' + recipe.title}
          className="flex w-full gap-4 rounded-lg p-1 text-left outline-none transition-colors hover:bg-surface-container-low/50 focus-visible:ring-2 focus-visible:ring-brand-green disabled:opacity-75"
        >
          <RecipeImage image={recipe.image} title={recipe.title} className="h-20 w-20 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <span className="block font-headline text-base font-bold leading-snug text-on-surface line-clamp-2">
              {recipe.title}
            </span>
            <div className="mt-2 flex items-center gap-3 text-[11px] font-semibold">
              {totalMinutes != null && (
                <span className="flex items-center gap-0.5 text-on-surface-variant">
                  <span aria-hidden="true" className="material-symbols-outlined" style={{ fontSize: '14px' }}>schedule</span>
                  {totalMinutes} min
                </span>
              )}
              {calories != null && (
                <span className="flex items-center gap-0.5 text-brand-green">
                  <span aria-hidden="true" className="material-symbols-outlined" style={{ fontSize: '14px' }}>local_fire_department</span>
                  {calories} kcal
                </span>
              )}
              {protein != null && (
                <span className="ml-auto rounded-full bg-brand-green/10 px-2 py-0.5 text-[10px] font-bold text-brand-green">
                  {protein}g prot
                </span>
              )}
            </div>
          </div>
        </a>
        <button
          type="button"
          disabled={isReplacing}
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
          className="mt-3 text-xs font-semibold text-brand-green hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
        >
          {isExpanded ? 'Ocultar ingredientes e instrucciones' : 'Ver ingredientes e instrucciones'}
        </button>
      </div>

      {/* Mobile in-card confirmation prompt */}
      {isConfirmingMobile && !isReplacing && (
        <MealCardMobileConfirm
          mealTitle={recipe.title}
          onConfirm={() => {
            setIsConfirmingMobile(false);
            handleTriggerReplace();
          }}
          onCancel={() => setIsConfirmingMobile(false)}
          isSubmitting={isReplacing}
        />
      )}

      {/* Expanded detail */}
      {isExpanded && !isConfirmingMobile && (
        <div className="space-y-4 border-t border-outline-variant/30 px-4 pt-3 pb-4">
          {recipe.description && (
            <p className="text-sm leading-relaxed text-on-surface-variant">{recipe.description}</p>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant mb-2">
              Ingredientes
            </p>
            {ingredients.length > 0 ? (
              <ul className="space-y-1 text-sm text-on-surface">
                {ingredients.map((ingredient, index) => (
                  <li key={index}>{formatIngredient(ingredient)}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-on-surface-variant">Ingredientes no disponibles todavía.</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant mb-2">
              Instrucciones
            </p>
            {instructions.length > 0 ? (
              <ol className="list-decimal space-y-1 pl-4 text-sm text-on-surface">
                {instructions.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-on-surface-variant">Instrucciones no disponibles todavía.</p>
            )}
          </div>
        </div>
      )}

      {/* Error banner */}
      {replaceError && (
        <MealCardErrorBanner
          message={replaceError.message}
          onRetry={replaceError.onRetry}
          onCancel={replaceError.onCancel}
        />
      )}
    </article>
  );
}
