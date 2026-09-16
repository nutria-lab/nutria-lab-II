import { useMemo, useState } from 'react';

import { Banner } from '../../../common/components/Banner';
import { Pill } from '../../../common/components/Pill';
import type { Recipe, RecipeCategory } from '../../../services/recipeService';

const CREATE_RECIPE_LABEL = 'Crear receta';

export type RecipeCatalogListProps = {
  recipes: Recipe[];
  status: 'loading' | 'empty' | 'error' | 'success';
  errorMessage: string | null;
  onRetry: () => void;
  selectedId?: string | null;
  onSelectRecipe: (id: string) => void;
  onCreateRecipe: () => void;
  onCreateIngredient: () => void;
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
// decide qué hacer con `onSelectRecipe`/`onCreateRecipe`/`onCreateIngredient`. Búsqueda y
// filtro de categoría son estado interno, no props controladas.
export function RecipeCatalogList({
  recipes,
  status,
  errorMessage,
  onRetry,
  selectedId = null,
  onSelectRecipe,
  onCreateRecipe,
  onCreateIngredient,
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
      const matchesSearch = !normalizedSearch || recipe.title.toLowerCase().includes(normalizedSearch);
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
    <div className="space-y-4">
      {status === 'error' && errorMessage && <Banner variant="error" message={errorMessage} />}

      <div>
        <label htmlFor="recipe-search" className="sr-only">
          Buscar recetas
        </label>
        <input
          id="recipe-search"
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Buscar recetas por nombre"
          className="min-h-[44px] w-full rounded-lg border border-brand-cream-dark bg-white px-4 text-sm text-neutral-900"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Pill
          label={`Todas (${recipes.length})`}
          selected={selectedCategory === null}
          onClick={() => setSelectedCategory(null)}
        />
        {categories.map((category) => (
          <Pill
            key={category}
            label={category}
            selected={selectedCategory === category}
            onClick={() => setSelectedCategory(category)}
          />
        ))}
        <Pill label="+ Ingrediente" selected={false} onClick={onCreateIngredient} />
      </div>

      {hasNoFilterResults ? (
        <p className="py-10 text-center text-sm text-neutral-500">
          No encontramos recetas que coincidan con tu búsqueda.
        </p>
      ) : (
        <div className="space-y-3">
          {filteredRecipes.map((recipe) => {
            const totalMinutes = recipe.prepMinutes + recipe.cookMinutes;
            const primaryCategory = (recipe.categories ?? [])[0] ?? 'Sin categoría';
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
                className="cursor-pointer space-y-2 rounded-2xl bg-white p-4 shadow-lg"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-brand-green/10 px-3 py-1 text-xs font-semibold text-brand-green-dark">
                    {primaryCategory}
                  </span>
                  <span className="text-xs text-neutral-500">{totalMinutes} min</span>
                </div>
                <h3 className="font-serif text-lg font-semibold text-neutral-900">{recipe.title}</h3>
                {/* La tarjeta actualmente seleccionada (p. ej. columna izquierda de escritorio,
                    `RecipeDetailPage`) omite la descripción para no duplicarla textualmente
                    contra la sección "Descripción" que el panel derecho ya muestra al mismo
                    tiempo para esa misma receta. */}
                {!isSelected && <p className="text-sm text-neutral-500">{recipe.description}</p>}
                {Boolean(recipe.nutritionalValues) && (
                  <p className="text-xs text-neutral-500">{recipe.nutritionalValues!.calories} kcal</p>
                )}
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
