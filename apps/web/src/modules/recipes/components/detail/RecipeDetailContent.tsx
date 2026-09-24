import type { Recipe } from '../../../../services/recipeService';
import { RECIPE_CATEGORY_LABELS } from '../../labels';

export function RecipeImagePlaceholder({ recipe }: { recipe: Recipe }) {
  const primaryCategoryRaw = (recipe.categories ?? [])[0];
  const primaryCategory = primaryCategoryRaw
    ? RECIPE_CATEGORY_LABELS[primaryCategoryRaw]
    : 'Sin categoría';

  return (
    <div className="relative h-48 w-full overflow-hidden rounded-2xl bg-surface-container">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-on-surface/50 to-transparent"
      />
      <div className="absolute bottom-3 left-3 right-3 space-y-1">
        <div>
          <span className="rounded-full bg-tertiary-container/80 px-3 py-1 text-xs font-bold uppercase tracking-wide text-on-tertiary-container">
            {primaryCategory}
          </span>
        </div>
        <h2 className="font-headline text-lg font-bold text-white">{recipe.title}</h2>
      </div>
    </div>
  );
}

export function RecipeDetailSections({ recipe }: { recipe: Recipe }) {
  const totalMinutes = recipe.prepMinutes + recipe.cookMinutes;
  const recipeProperties = recipe.properties ?? [];

  return (
    <>
      {/* Stats row */}
      <div className="flex flex-wrap gap-4 text-sm text-on-surface-variant">
        <span className="flex flex-col items-start gap-0.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant/70">
            Tiempo
          </span>
          <span className="font-semibold text-on-surface">{totalMinutes} min</span>
        </span>
        {Boolean(recipe.nutritionalValues) ? (
          <>
            <span className="flex flex-col items-start gap-0.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant/70">
                Calorías
              </span>
              <span className="font-semibold text-on-surface">
                {recipe.nutritionalValues!.calories} kcal
              </span>
            </span>
            <span className="flex flex-col items-start gap-0.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant/70">
                Proteína
              </span>
              <span className="font-semibold text-on-surface">
                {recipe.nutritionalValues!.protein} g
              </span>
            </span>
            <span className="flex flex-col items-start gap-0.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant/70">
                Carbos
              </span>
              <span className="font-semibold text-on-surface">
                {recipe.nutritionalValues!.carbs} g
              </span>
            </span>
          </>
        ) : (
          <span className="text-on-surface-variant text-xs italic">Sin datos</span>
        )}
      </div>

      <section>
        <h2 className="font-headline text-lg font-semibold text-on-surface">Descripción</h2>
        <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">{recipe.description}</p>
      </section>

      <section>
        <h2 className="font-headline text-lg font-semibold text-on-surface">
          {`Ingredientes (${recipe.ingredients.length})`}
        </h2>
        <ul className="mt-2 space-y-2 text-sm text-on-surface">
          {recipe.ingredients.map((item, index) => (
            <li
              key={`${item.name}-${index}`}
              className="flex items-center justify-between rounded-xl border border-outline-variant/30 bg-white p-3 shadow-sm"
            >
              <span>{item.name}</span>
              <span className="font-semibold text-brand-green">{`${item.quantity} ${item.unit}`}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-headline text-lg font-semibold text-on-surface">Pasos de Preparación</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-on-surface-variant">
          {recipe.instructions.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </section>

      {recipeProperties.length > 0 && (
        <section>
          <h2 className="font-headline text-lg font-semibold text-on-surface">
            Propiedades y Restricciones
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {recipeProperties.map((property) => (
              <li
                key={property}
                className="rounded-full bg-surface-container px-3 py-1 text-xs font-bold uppercase tracking-wide text-on-surface-variant"
              >
                {property}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function DesktopRecipeHero({ recipe }: { recipe: Recipe }) {
  const primaryCategoryRaw = (recipe.categories ?? [])[0];
  const primaryCategory = primaryCategoryRaw
    ? RECIPE_CATEGORY_LABELS[primaryCategoryRaw]
    : 'Sin categoría';
  const totalMinutes = recipe.prepMinutes + recipe.cookMinutes;

  return (
    <div className="grid grid-cols-12 gap-5 items-center">
      <div className="col-span-5 h-44 rounded-xl overflow-hidden bg-surface-container relative shadow-xs flex items-center justify-center">
        <span aria-hidden="true" className="material-symbols-outlined text-5xl text-outline-variant/60">
          restaurant
        </span>
        <span className="absolute bottom-2 left-2 rounded-md bg-brand-green-dark/90 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-xs">
          {primaryCategory}
        </span>
      </div>
      <div className="col-span-7 space-y-2">
        <h2 className="font-headline text-2xl font-bold leading-tight text-on-surface">{recipe.title}</h2>
        <p className="line-clamp-3 text-xs leading-relaxed text-on-surface-variant">{recipe.description}</p>
        <div className="flex items-center gap-4 pt-2 text-xs font-bold text-on-surface-variant">
          <div className="flex items-center gap-1 text-brand-green">
            <span aria-hidden="true" className="material-symbols-outlined text-base">schedule</span>
            <span>{totalMinutes} min</span>
          </div>
          {recipe.nutritionalValues && (
            <div className="flex items-center gap-1 text-tertiary">
              <span aria-hidden="true" className="material-symbols-outlined text-base">local_fire_department</span>
              <span>{recipe.nutritionalValues.calories} kcal</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function DesktopNutritionalValues({ recipe }: { recipe: Recipe }) {
  if (!recipe.nutritionalValues) {
    return (
      <div className="p-3 bg-surface-container-low rounded-xl border border-outline-variant/30 text-xs text-on-surface-variant text-center italic">
        Sin datos
      </div>
    );
  }

  return (
    <div className="p-4 bg-surface-container-low rounded-xl border border-outline-variant/30">
      <span className="text-xs font-bold text-on-surface block mb-2.5 flex items-center gap-1.5">
        <span aria-hidden="true" className="material-symbols-outlined text-sm text-tertiary">monitoring</span>
        <span>Valores Nutricionales y Aportes</span>
      </span>
      <div className="grid grid-cols-4 gap-3 text-center">
        <div className="p-2.5 rounded-lg bg-white border border-outline-variant/20 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-on-surface-variant/70 block">Calorías</span>
          <span className="text-base font-bold text-brand-green">{recipe.nutritionalValues.calories} kcal</span>
        </div>
        <div className="p-2.5 rounded-lg bg-white border border-outline-variant/20 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-on-surface-variant/70 block">Proteínas</span>
          <span className="text-base font-bold text-brand-green">{recipe.nutritionalValues.protein} g</span>
        </div>
        <div className="p-2.5 rounded-lg bg-white border border-outline-variant/20 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-on-surface-variant/70 block">Carbohidratos</span>
          <span className="text-base font-bold text-brand-green">{recipe.nutritionalValues.carbs} g</span>
        </div>
        <div className="p-2.5 rounded-lg bg-white border border-outline-variant/20 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-on-surface-variant/70 block">Grasas Saludables</span>
          <span className="text-base font-bold text-brand-green">{recipe.nutritionalValues.fat} g</span>
        </div>
      </div>
    </div>
  );
}

export function DesktopIngredientsAndSteps({ recipe }: { recipe: Recipe }) {
  const recipeProperties = recipe.properties ?? [];

  return (
    <div className="grid grid-cols-12 gap-5">
      {/* Ingredientes con Unidades */}
      <section className="col-span-6 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-headline font-bold text-sm text-on-surface flex items-center gap-1.5">
            <span aria-hidden="true" className="material-symbols-outlined text-brand-green text-base">kitchen</span>
            <span>{`Ingredientes (${recipe.ingredients.length})`}</span>
          </h2>
        </div>
        <ul className="space-y-1.5 text-xs max-h-56 overflow-y-auto pr-1">
          {recipe.ingredients.map((item, index) => (
            <li
              key={`${item.name}-${index}`}
              className="flex items-center justify-between p-2 rounded-lg bg-surface-container-low border border-outline-variant/20 transition-colors hover:bg-white"
            >
              <span className="font-medium text-on-surface">• {item.name}</span>
              <span className="font-bold text-brand-green">{`${item.quantity} ${item.unit}`}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Pasos y Propiedades */}
      <div className="col-span-6 space-y-3">
        <section className="space-y-1.5">
          <h2 className="font-headline font-bold text-sm text-on-surface flex items-center gap-1.5">
            <span aria-hidden="true" className="material-symbols-outlined text-tertiary text-base">format_list_numbered</span>
            <span>Pasos de Preparación</span>
          </h2>
          <div className="p-3 bg-surface-container-low rounded-xl border border-outline-variant/30 text-xs text-on-surface-variant leading-relaxed max-h-48 overflow-y-auto">
            <ol className="list-decimal space-y-1.5 pl-4">
              {recipe.instructions.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          </div>
        </section>

        {recipeProperties.length > 0 && (
          <section>
            <h2 className="font-headline text-xs font-bold text-on-surface mb-1">
              Propiedades y Restricciones
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {recipeProperties.map((property) => (
                <span
                  key={property}
                  className="rounded-full bg-brand-green/10 px-2.5 py-0.5 text-[10px] font-bold text-brand-green"
                >
                  {property}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
