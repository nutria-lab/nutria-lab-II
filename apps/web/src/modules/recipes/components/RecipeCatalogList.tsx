import { useMemo, useState } from 'react';

import { Banner } from '../../../common/components/Banner';
import { Pill } from '../../../common/components/Pill';
import type { Recipe, RecipeCategory } from '../../../services/recipeService';
import { RECIPE_CATEGORY_BADGE_CLASSES, RECIPE_CATEGORY_LABELS } from '../labels';

const CREATE_RECIPE_LABEL = 'Crear receta';
const UNCATEGORIZED_BADGE_CLASSES = 'bg-surface-container-highest text-on-surface-variant';

export type RecipeCatalogListProps = {
  recipes: Recipe[];
  status: 'loading' | 'empty' | 'error' | 'success';
  errorMessage: string | null;
  onRetry: () => void;
  onRefresh?: () => void;
  selectedId?: string | null;
  onSelectRecipe: (id: string) => void;
  onCreateRecipe: () => void;
  onCreateIngredient?: () => void;
};

function LoadingSkeleton() {
  return (
    <div
      data-testid="recipes-loading-skeleton"
      aria-busy="true"
      aria-live="polite"
      className="animate-pulse space-y-4"
    >
      <div className="h-10 w-full rounded-2xl bg-surface-container" />
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-8 w-20 shrink-0 rounded-full bg-surface-container" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-28 rounded-2xl bg-surface-container" />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-container">
        <span className="material-symbols-outlined text-2xl text-on-surface-variant">restaurant_menu</span>
      </div>
      <p className="font-headline text-base font-bold text-on-surface">Todavía no tenés recetas</p>
      <p className="mt-1 text-xs text-on-surface-variant">
        Creá tu primera receta para empezar a armar tu recetario.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-4 rounded-full bg-brand-green/10 px-4 py-1.5 text-xs font-bold text-brand-green transition-all hover:bg-brand-green/20"
      >
        {CREATE_RECIPE_LABEL}
      </button>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-8 text-center">
      <p className="font-headline text-base font-bold text-on-surface">Algo salió mal</p>
      <p className="mt-1 text-xs text-on-surface-variant">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-full bg-brand-green/10 px-4 py-1.5 text-xs font-bold text-brand-green"
      >
        Reintentar
      </button>
    </div>
  );
}

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

  if (status === 'loading') return <LoadingSkeleton />;
  if (status === 'empty') return <EmptyState onCreate={onCreateRecipe} />;
  if (status === 'error' && recipes.length === 0) {
    return <ErrorState message={errorMessage ?? 'No pudimos cargar tus recetas.'} onRetry={onRetry} />;
  }

  const hasNoFilterResults = recipes.length > 0 && filteredRecipes.length === 0;

  return (
    <div className="space-y-4">
      {status === 'error' && errorMessage && <Banner variant="error" message={errorMessage} />}

      {/* Search input */}
      <div className="relative">
        <label htmlFor="recipe-search" className="sr-only">Buscar recetas</label>
        <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-on-surface-variant">
          <span className="material-symbols-outlined text-lg">search</span>
        </div>
        <input
          id="recipe-search"
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Buscar por nombre o ingrediente..."
          className="w-full rounded-2xl border border-outline-variant/50 bg-surface-container-low py-2.5 pl-10 pr-9 text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none transition-all focus:border-brand-green focus:ring-2 focus:ring-brand-green/20"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            className="absolute inset-y-0 right-2 flex items-center px-1 text-on-surface-variant hover:text-on-surface"
            aria-label="Limpiar búsqueda"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        )}
      </div>

      {/* Category pills — horizontal scroll */}
      <div
        data-testid="recipe-category-chips"
        className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
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

      {/* Count row */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
          {`${recipes.length} recetas disponibles`}
        </span>
        <button
          type="button"
          onClick={onRefresh ?? onRetry}
          className="flex items-center gap-1 text-xs font-semibold text-brand-green hover:underline"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-sm">refresh</span>
          Actualizar
        </button>
      </div>

      {hasNoFilterResults ? (
        <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-8 text-center">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant">search_off</span>
          <p className="mt-2 font-headline text-sm font-bold text-on-surface">
            No se encontraron recetas
          </p>
          <p className="mt-1 text-xs text-on-surface-variant">
            No encontramos recetas que coincidan con tu búsqueda.
          </p>
          <button
            type="button"
            onClick={() => { setSearchTerm(''); setSelectedCategory(null); }}
            className="mt-3 rounded-full bg-brand-green/10 px-3 py-1.5 text-xs font-bold text-brand-green"
          >
            Ver todas las recetas
          </button>
        </div>
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
                className={`flex cursor-pointer items-center gap-3.5 overflow-hidden rounded-2xl border border-outline-variant/30 p-3 shadow-sm transition-all active:scale-[0.99] hover:shadow-md ${
                  isSelected ? 'bg-primary-fixed/20' : 'bg-white'
                }`}
              >
                {/* Thumbnail with category badge overlay */}
                <div
                  data-testid="recipe-card-thumbnail"
                  className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-surface-container"
                >
                  <span
                    className={`absolute left-1 top-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${categoryBadgeClasses}`}
                  >
                    {primaryCategory}
                  </span>
                </div>

                {/* Text content */}
                <div className="min-w-0 flex-1">
                  <h3 className="font-headline text-sm font-bold leading-snug text-on-surface line-clamp-1">
                    {recipe.title}
                  </h3>
                  {!isSelected && (
                    <p className="mt-0.5 text-[11px] leading-relaxed text-on-surface-variant line-clamp-2">
                      {recipe.description}
                    </p>
                  )}
                  {/* Stats row */}
                  <div className="mt-2 flex items-center gap-3 text-[11px] font-semibold">
                    <span className="flex items-center gap-0.5 text-on-surface-variant">
                      <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>schedule</span>
                      {totalMinutes} min
                    </span>
                    {recipe.nutritionalValues && (
                      <>
                        <span className="flex items-center gap-0.5 text-brand-green">
                          <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>local_fire_department</span>
                          {recipe.nutritionalValues.calories} kcal
                        </span>
                        <span className="ml-auto rounded-full bg-brand-green/10 px-2 py-0.5 text-[10px] font-bold text-brand-green">
                          {recipe.nutritionalValues.protein}g prot
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* FAB — above the bottom nav bar */}
      <button
        type="button"
        onClick={onCreateRecipe}
        aria-label={CREATE_RECIPE_LABEL}
        className="fixed bottom-24 right-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand-green text-2xl font-semibold text-on-primary shadow-lg transition-all hover:opacity-90 active:scale-95"
      >
        <span className="material-symbols-outlined text-2xl">add</span>
      </button>
    </div>
  );
}
