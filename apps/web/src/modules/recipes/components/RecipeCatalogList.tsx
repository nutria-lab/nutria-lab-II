import { useMemo, useState } from 'react';

import { Banner } from '../../../common/components/Banner';
import { Pill } from '../../../common/components/Pill';
import type { Recipe, RecipeCategory } from '../../../services/recipeService';
import { RECIPE_CATEGORY_BADGE_CLASSES, RECIPE_CATEGORY_LABELS } from '../labels';

const CREATE_RECIPE_LABEL = 'Crear receta';
// Fallback neutro para tarjetas sin categoría (backend real pre-NUT-61), mismo criterio ya
// usado por el badge de texto ("Sin categoría").
const UNCATEGORIZED_BADGE_CLASSES = 'bg-neutral-400 text-white';

export type RecipeCatalogListProps = {
  recipes: Recipe[];
  status: 'loading' | 'empty' | 'error' | 'success';
  errorMessage: string | null;
  onRetry: () => void;
  // NUT-20 (ajuste visual pedido por la PO): botón "Actualizar" reubicado a la fila
  // "N RECETAS DISPONIBLES" de este componente. Se mantiene separado de `onRetry` (que sigue
  // siendo el disparador del botón "Reintentar" del estado de error) porque en `RecipesListPage`
  // ambos apuntan a funciones distintas dentro de los tests unitarios, aunque en producción
  // `useRecipes` los implemente con la misma función. Opcional (con fallback a `onRetry`) porque
  // `RecipeCatalogList.test.tsx` (archivo de test, no editable en esta ronda) no la pasa en
  // ninguno de sus renders.
  onRefresh?: () => void;
  selectedId?: string | null;
  onSelectRecipe: (id: string) => void;
  onCreateRecipe: () => void;
  // NUT-20: ya NO se usa acá (el chip "+ Ingrediente" se movió al header de
  // `RecipesListPage`/columna izquierda de `DesktopRecipeDetail`). Se mantiene opcional y sin
  // destructurar únicamente porque `RecipeCatalogList.test.tsx` (archivo de test, no editable en
  // esta ronda) todavía la sigue pasando en varios de sus renders; sin este campo el build
  // fallaría por "excess property" en ese test. Candidato a limpieza cuando el tester actualice
  // ese archivo.
  onCreateIngredient?: () => void;
};

function LoadingSkeleton() {
  return (
    <div
      data-testid="recipes-loading-skeleton"
      aria-busy="true"
      aria-live="polite"
      className="mx-auto max-w-3xl animate-pulse space-y-4 px-4 py-6 md:px-8"
    >
      <div className="h-10 w-full rounded-lg bg-brand-cream-dark" />
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-8 w-20 shrink-0 rounded-full bg-brand-cream-dark" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-28 rounded-2xl bg-brand-cream-dark" />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 text-center md:px-8">
      <p className="font-serif text-lg font-semibold text-neutral-900">
        Todavía no tenés recetas
      </p>
      <p className="mt-2 text-sm text-neutral-500">
        Creá tu primera receta para empezar a armar tu recetario.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-4 min-h-[44px] rounded-lg bg-brand-green px-6 text-sm font-semibold text-white"
      >
        {CREATE_RECIPE_LABEL}
      </button>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 text-center md:px-8">
      <p className="font-serif text-lg font-semibold text-neutral-900">Algo salió mal</p>
      <p className="mt-2 text-sm text-neutral-500">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 min-h-[44px] rounded-lg bg-brand-green px-6 text-sm font-semibold text-white"
      >
        Reintentar
      </button>
    </div>
  );
}

// Extraído de `RecipesListPage.tsx` (design.md sección 9.2/9.3): buscador/chips/tarjetas de
// listado, reutilizado tanto por `RecipesListPage` (mobile) como por la columna izquierda de
// `RecipeDetailPage` en escritorio. Agnóstico de navegación/router a propósito — quien lo usa
// decide qué hacer con `onSelectRecipe`/`onCreateRecipe`. El chip "+ Ingrediente" que vivía acá
// se movió al header de `RecipesListPage` (ajuste visual NUT-20); este componente ya no conoce
// esa acción. Búsqueda y filtro de categoría son estado interno, no props controladas.
export function RecipeCatalogList({
  recipes,
  status,
  errorMessage,
  onRetry,
  onRefresh,
  selectedId = null,
  onSelectRecipe,
  onCreateRecipe,
}: RecipeCatalogListProps) {
  const [selectedCategory, setSelectedCategory] = useState<RecipeCategory | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Guarda defensiva (backend real pre-NUT-61): `categories` puede venir `undefined`.
  const categories = useMemo(
    () => Array.from(new Set(recipes.flatMap((recipe) => recipe.categories ?? []))),
    [recipes],
  );

  const filteredRecipes = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return recipes.filter((recipe) => {
      const recipeCategories = recipe.categories ?? [];
      const matchesCategory = !selectedCategory || recipeCategories.includes(selectedCategory);
      const matchesTitle = recipe.title.toLowerCase().includes(normalizedSearch);
      const matchesIngredient = (recipe.ingredients ?? []).some((ingredient) =>
        ingredient.name.toLowerCase().includes(normalizedSearch),
      );
      const matchesSearch = !normalizedSearch || matchesTitle || matchesIngredient;
      return matchesCategory && matchesSearch;
    });
  }, [recipes, selectedCategory, searchTerm]);

  if (status === 'loading') {
    return <LoadingSkeleton />;
  }

  if (status === 'empty') {
    return <EmptyState onCreate={onCreateRecipe} />;
  }

  if (status === 'error' && recipes.length === 0) {
    return <ErrorState message={errorMessage ?? 'No pudimos cargar tus recetas.'} onRetry={onRetry} />;
  }

  const hasNoFilterResults = recipes.length > 0 && filteredRecipes.length === 0;

  return (
    <div className="space-y-3">
      {status === 'error' && errorMessage && <Banner variant="error" message={errorMessage} />}

      <div className="relative">
        <label htmlFor="recipe-search" className="sr-only">
          Buscar recetas
        </label>
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3-3" />
        </svg>
        <input
          id="recipe-search"
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Buscar por nombre o ingrediente..."
          className="min-h-10 w-full rounded-full border border-brand-cream-dark bg-white pl-9 pr-4 text-sm text-neutral-900"
        />
      </div>

      <div data-testid="recipe-category-chips" className="flex flex-wrap gap-2">
        <Pill
          label={`Todas (${recipes.length})`}
          selected={selectedCategory === null}
          onClick={() => setSelectedCategory(null)}
        />
        {categories.map((category) => (
          <Pill
            key={category}
            label={RECIPE_CATEGORY_LABELS[category]}
            selected={selectedCategory === category}
            onClick={() => setSelectedCategory(category)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {`${recipes.length} recetas disponibles`}
        </span>
        <button
          type="button"
          onClick={onRefresh ?? onRetry}
          className="text-xs font-semibold text-brand-green-dark"
        >
          <span aria-hidden="true">↻ </span>
          Actualizar
        </button>
      </div>

      {hasNoFilterResults ? (
        <p className="py-10 text-center text-sm text-neutral-500">
          No encontramos recetas que coincidan con tu búsqueda.
        </p>
      ) : (
        <div className="space-y-3">
          {filteredRecipes.map((recipe) => {
            const totalMinutes = recipe.prepMinutes + recipe.cookMinutes;
            const primaryCategoryRaw = (recipe.categories ?? [])[0];
            const primaryCategory = primaryCategoryRaw
              ? RECIPE_CATEGORY_LABELS[primaryCategoryRaw]
              : 'Sin categoría';
            const categoryBadgeClasses = primaryCategoryRaw
              ? RECIPE_CATEGORY_BADGE_CLASSES[primaryCategoryRaw]
              : UNCATEGORIZED_BADGE_CLASSES;
            const isSelected = selectedId != null && selectedId === recipe.id;
            return (
              <div
                key={recipe.id}
                data-testid={`recipe-card-${recipe.id}`}
                role="button"
                tabIndex={0}
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => onSelectRecipe(recipe.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectRecipe(recipe.id);
                  }
                }}
                className="flex cursor-pointer gap-3 rounded-2xl bg-white p-4 shadow-lg"
              >
                {/* Placeholder de imagen (skeleton estático, NO una foto real: el backend no
                    expone ninguna URL de imagen), mismo criterio que `RecipeImagePlaceholder`
                    de `RecipeDetailPage.tsx`, en tamaño chico para la tarjeta del listado. */}
                <div
                  data-testid="recipe-card-thumbnail"
                  className="h-16 w-16 shrink-0 rounded-xl bg-brand-cream-dark"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${categoryBadgeClasses}`}
                    >
                      {primaryCategory}
                    </span>
                    <span className="text-xs text-neutral-500">{totalMinutes} min</span>
                  </div>
                  <h3 className="font-serif text-lg font-semibold text-neutral-900">
                    {recipe.title}
                  </h3>
                  {/* La tarjeta actualmente seleccionada (p. ej. columna izquierda de escritorio,
                      `RecipeDetailPage`) omite la descripción para no duplicarla textualmente
                      contra la sección "Descripción" que el panel derecho ya muestra al mismo
                      tiempo para esa misma receta. */}
                  {!isSelected && <p className="text-sm text-neutral-500">{recipe.description}</p>}
                  {Boolean(recipe.nutritionalValues) && (
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs text-neutral-500">
                        {recipe.nutritionalValues!.calories} kcal
                      </span>
                      <span className="rounded-full bg-brand-green/10 px-2 py-0.5 text-xs font-semibold text-brand-green-dark">
                        {`${recipe.nutritionalValues!.protein}g prot`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onCreateRecipe}
        aria-label={CREATE_RECIPE_LABEL}
        className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand-green text-2xl font-semibold text-white shadow-lg"
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
