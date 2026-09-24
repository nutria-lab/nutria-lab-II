import { useState } from 'react';
import type { Meal } from '../../../services/mealPlanService';
import { MEAL_TYPE_LABELS } from '../utils';

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

type MealCardProps = {
  meal: Meal;
};

export function MealCard({ meal }: MealCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { recipe } = meal;

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

  const totalMinutes =
    (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0) || null;
  const calories = meal.nutritionalValues?.Calories;
  const protein = meal.nutritionalValues?.Protein;
  const ingredients = recipe.ingredients ?? [];
  const instructions = recipe.instructions ?? [];

  return (
    <article className="overflow-hidden rounded-xl bg-white shadow-[0_4px_20px_rgba(46,50,48,0.06)] border border-outline-variant/30 transition-shadow hover:shadow-md">
      {/* Card toggle button */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        className="w-full text-left flex gap-4 p-4 transition-colors hover:bg-surface-container-low/50"
      >
        {/* Thumbnail */}
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-surface-container">
          {/* Placeholder — real image would go here */}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <MealTypeBadge mealType={meal.mealType} />
          <h3 className="mt-1 font-headline text-base font-bold text-on-surface leading-snug line-clamp-2">
            {recipe.title}
          </h3>

          {/* Meta row */}
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
      </button>

      {/* Expanded detail */}
      {isExpanded && (
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
                  <li key={index}>{`${ingredient.quantity} ${ingredient.unit} ${ingredient.name}`}</li>
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
    </article>
  );
}
