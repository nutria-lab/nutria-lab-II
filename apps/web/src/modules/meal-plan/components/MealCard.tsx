import { useState } from 'react';
import type { Meal } from '../../../services/mealPlanService';
import { MEAL_TYPE_LABELS, formatIngredient } from '../utils';
import { ChevronIcon } from '../../../common/components/ChevronIcon';

type MealCardProps = {
  meal: Meal;
};

export function MealCard({ meal }: MealCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { recipe } = meal;

  const servingsLabel =
    meal.servings != null ? `${meal.servings} ${meal.servings === 1 ? 'porción' : 'porciones'}` : null;

  // La receta puede venir ausente aunque el tipo la declare obligatoria: es un límite
  // externo (API), no algo que TypeScript pueda garantizar en tiempo de ejecución.
  if (!recipe) {
    return (
      <div className="flex min-h-[44px] items-center gap-4 rounded-2xl bg-white p-4 shadow-sm">
        <div className="h-14 w-14 shrink-0 rounded-xl bg-neutral-100" aria-hidden="true" />
        <div>
          <p className="font-serif text-base font-semibold text-neutral-400">Receta no disponible</p>
          <p className="text-sm text-neutral-400">{MEAL_TYPE_LABELS[meal.mealType]}</p>
        </div>
      </div>
    );
  }

  const ingredients = recipe.ingredients ?? [];
  const instructions = recipe.instructions ?? [];

  return (
    <div className="rounded-2xl bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
        className="flex min-h-[44px] w-full items-center gap-4 rounded-2xl p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
      >
        <div className="h-14 w-14 shrink-0 rounded-xl bg-brand-cream-dark" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-serif text-base font-semibold text-neutral-900">{recipe.title}</p>
          <p className="text-sm text-neutral-500">
            {MEAL_TYPE_LABELS[meal.mealType]}
            {servingsLabel ? ` · ${servingsLabel}` : ''}
          </p>
        </div>
        <ChevronIcon
          className={`h-5 w-5 shrink-0 text-neutral-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {isExpanded && (
        <div className="space-y-3 border-t border-neutral-100 px-4 pt-3 pb-4">
          {recipe.description && <p className="text-sm text-neutral-600">{recipe.description}</p>}

          {(recipe.prepMinutes != null || recipe.cookMinutes != null) && (
            <p className="text-xs text-neutral-500">
              {recipe.prepMinutes != null ? `Preparación: ${recipe.prepMinutes} min` : ''}
              {recipe.prepMinutes != null && recipe.cookMinutes != null ? ' · ' : ''}
              {recipe.cookMinutes != null ? `Cocción: ${recipe.cookMinutes} min` : ''}
            </p>
          )}

          <div>
            <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Ingredientes</p>
            {ingredients.length > 0 ? (
              <ul className="mt-1 space-y-1 text-sm text-neutral-700">
                {ingredients.map((ingredient, index) => (
                  <li key={index}>{formatIngredient(ingredient)}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-neutral-400">Ingredientes no disponibles todavía.</p>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Instrucciones</p>
            {instructions.length > 0 ? (
              <ol className="mt-1 list-decimal space-y-1 pl-4 text-sm text-neutral-700">
                {instructions.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-sm text-neutral-400">Instrucciones no disponibles todavía.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
