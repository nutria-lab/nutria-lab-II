import { useMemo, useState } from 'react';

import { Banner } from '../../../common/components/Banner';
import { Pill } from '../../../common/components/Pill';
import { SearchInput } from '../../../common/components/SearchInput';
import type { Recipe, RecipeCategory } from '../../../services/recipeService';
import type { UseRecipeSearchResult } from '../hooks/useRecipeSearch';
import { RECIPE_CATEGORY_BADGE_CLASSES, RECIPE_CATEGORY_LABELS } from '../labels';
import { RecipeTimeFilterSheet } from './RecipeTimeFilterSheet';

const CREATE_RECIPE_LABEL = 'Crear receta';
const UNCATEGORIZED_BADGE_CLASSES = 'bg-surface-container-highest text-on-surface-variant';

export type RecipeCatalogListProps = {
  recipes?: Recipe[];
  status?: 'loading' | 'empty' | 'error' | 'success';
  errorMessage?: string | null;
  onRetry?: () => void;
  onRefresh?: () => void;
  selectedId?: string | null;
  onSelectRecipe: (id: string) => void;
  onCreateRecipe: () => void;
  onCreateIngredient?: () => void;
  hideSearch?: boolean;
  hideHeader?: boolean;
  searchTerm?: string;
  onSearchTermChange?: (term: string) => void;

  search?: UseRecipeSearchResult;
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
  recipes: propRecipes = [],
  status: propStatus = 'loading',
  errorMessage: propErrorMessage = null,
  onRetry: propOnRetry = () => {},
  onRefresh: propOnRefresh,
  selectedId = null,
  onSelectRecipe,
  onCreateRecipe,
  hideSearch = false,
  hideHeader = false,
  searchTerm: propSearchTerm,
  onSearchTermChange,
  search,
}: RecipeCatalogListProps) {
  const [isTimeSheetOpen, setIsTimeSheetOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<RecipeCategory | null>(null);
  const [internalSearchTerm, setInternalSearchTerm] = useState('');

  const isSearchMode = Boolean(search);

  const recipes = search ? search.recipes : propRecipes;
  const status = search ? search.status : propStatus;
  const errorMessage = search ? search.errorMessage : propErrorMessage;
  const onRetry = search ? search.retry : propOnRetry;
  const onRefresh = search ? search.refetch : (propOnRefresh ?? propOnRetry);

  const searchTerm = search
    ? search.draftText
    : propSearchTerm !== undefined
      ? propSearchTerm
      : internalSearchTerm;

  const setSearchTerm = search
    ? search.setDraftText
    : (onSearchTermChange ?? setInternalSearchTerm);

  // Available categories for legacy/desktop mode
  const categories = useMemo(
    () => Array.from(new Set(recipes.flatMap((recipe) => recipe.categories ?? []))),
    [recipes],
  );

  // Available property chips for mobile search mode
  const filterProperties = useMemo(() => {
    const defaultProps = [
      'Alto en Proteína',
      'Bajo en Grasa',
      'Sin Gluten',
      'Alto en Fibra',
      'Vegano',
      'Vegetariano',
      'Keto',
    ];
    const set = new Set<string>(defaultProps);
    if (search) {
      search.recipes.forEach((r) => {
        (r.properties ?? []).forEach((p) => {
          if (p && p.trim()) set.add(p.trim());
        });
      });
      search.properties.forEach((p) => {
        if (p && p.trim()) set.add(p.trim());
      });
    }
    return Array.from(set);
  }, [search]);

  // Client-side filtering when in legacy mode (no search hook)
  const filteredRecipes = useMemo(() => {
    if (isSearchMode) {
      return recipes;
    }
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
  }, [isSearchMode, recipes, selectedCategory, searchTerm]);

  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
      (search && (search.properties.length > 0 || search.maxPrepMinutes !== undefined)) ||
      (!search && selectedCategory !== null),
  );

  if (!isSearchMode && status === 'loading') return <LoadingSkeleton />;
  if (status === 'empty' && !hasActiveFilters) return <EmptyState onCreate={onCreateRecipe} />;
  if (!isSearchMode && status === 'error' && recipes.length === 0) {
    return <ErrorState message={errorMessage ?? 'No pudimos cargar tus recetas.'} onRetry={onRetry} />;
  }

  const hasNoFilterResults =
    (isSearchMode && status === 'empty') ||
    (!isSearchMode && recipes.length > 0 && filteredRecipes.length === 0);

  const totalCount = search ? search.total : recipes.length;

  return (
    <div className="space-y-4">
      {status === 'error' && errorMessage && <Banner variant="error" message={errorMessage} />}

      {/* Search input (when not hidden by parent desktop header) */}
      {!hideSearch && (
        <SearchInput
          id="recipe-search"
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Buscar por nombre o ingrediente..."
          variant="default"
        />
      )}

      {/* Dynamic property pills + prep time button (Mobile search mode) */}
      {isSearchMode && search ? (
        <>
          <div
            data-testid="recipe-property-chips"
            className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <button
              type="button"
              role="button"
              aria-pressed={search.properties.length === 0 ? 'true' : 'false'}
              onClick={() => {
                if (search.properties.length > 0) {
                  search.properties.forEach((p) => search.toggleProperty(p));
                }
              }}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
                search.properties.length === 0
                  ? 'bg-brand-green text-on-primary shadow-sm'
                  : 'border border-outline-variant/40 bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {`Todas (${search.total})`}
            </button>

            {filterProperties.map((prop) => {
              const isSelected = search.properties.includes(prop);
              return (
                <button
                  key={prop}
                  type="button"
                  role="button"
                  aria-pressed={isSelected ? 'true' : 'false'}
                  onClick={() => search.toggleProperty(prop)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    isSelected
                      ? 'bg-brand-green text-on-primary shadow-sm'
                      : 'border border-outline-variant/40 bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  {prop}
                </button>
              );
            })}

            {/* Prep Time Filter Button */}
            <button
              type="button"
              onClick={() => setIsTimeSheetOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={isTimeSheetOpen}
              aria-label={
                search.maxPrepMinutes
                  ? `Tiempo de preparación máximo: ${search.maxPrepMinutes} minutos`
                  : 'Filtrar por tiempo de preparación'
              }
              className={`flex shrink-0 items-center gap-1 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all ${
                search.maxPrepMinutes
                  ? 'border-brand-green bg-brand-green text-on-primary shadow-sm'
                  : 'border border-outline-variant/40 bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              <span className="material-symbols-outlined text-sm" aria-hidden="true">
                schedule
              </span>
              <span>{search.maxPrepMinutes ? `≤ ${search.maxPrepMinutes} min` : 'Tiempo'}</span>
            </button>
          </div>

          <RecipeTimeFilterSheet
            open={isTimeSheetOpen}
            onClose={() => setIsTimeSheetOpen(false)}
            selectedMinutes={search.maxPrepMinutes}
            onSelectMinutes={search.setMaxPrepMinutes}
          />
        </>
      ) : (
        /* Legacy category pills — horizontal scroll */
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
      )}

      {/* Count row (optional, when not provided by desktop header) */}
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <span
            aria-live="polite"
            className="text-xs font-bold uppercase tracking-wider text-on-surface-variant"
          >
            {`${totalCount} ${totalCount === 1 ? 'receta disponible' : 'recetas disponibles'}`}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            className="flex items-center gap-1 text-xs font-semibold text-brand-green hover:underline"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-sm">
              refresh
            </span>
            Actualizar
          </button>
        </div>
      )}

      {status === 'loading' && recipes.length === 0 ? (
        <div
          data-testid="recipes-loading-skeleton"
          aria-busy="true"
          aria-live="polite"
          className="animate-pulse space-y-3"
        >
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-28 rounded-2xl bg-surface-container" />
          ))}
        </div>
      ) : status === 'error' && recipes.length === 0 ? (
        <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-8 text-center">
          <p className="font-headline text-base font-bold text-on-surface">Algo salió mal</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            {errorMessage ?? 'No pudimos cargar tus recetas.'}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={onRetry}
              className="rounded-full bg-brand-green/10 px-4 py-1.5 text-xs font-bold text-brand-green hover:bg-brand-green/20"
            >
              Reintentar
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  if (search) {
                    search.clearFilters();
                  } else {
                    setSearchTerm('');
                    setSelectedCategory(null);
                  }
                }}
                className="rounded-full border border-outline-variant/40 bg-surface-container px-4 py-1.5 text-xs font-bold text-on-surface hover:bg-surface-container-high"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>
      ) : hasNoFilterResults ? (
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
            onClick={() => {
              if (search) {
                search.clearFilters();
              } else {
                setSearchTerm('');
                setSelectedCategory(null);
              }
            }}
            aria-label="Limpiar filtros"
            className="mt-3 rounded-full bg-brand-green/10 px-3 py-1.5 text-xs font-bold text-brand-green hover:bg-brand-green/20"
          >
            {isSearchMode ? 'Limpiar filtros' : 'Ver todas las recetas'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRecipes.map((recipe) => {
            const totalMinutes = recipe.prepMinutes + recipe.cookMinutes;
            const primaryCategoryRaw = (recipe.categories ?? [])[0];
            const primaryCategory = primaryCategoryRaw
              ? RECIPE_CATEGORY_LABELS[primaryCategoryRaw]
              : (recipe.properties ?? [])[0] ?? 'Sin categoría';
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
                className={`flex cursor-pointer items-center gap-3.5 overflow-hidden rounded-xl border p-3.5 shadow-sm transition-all active:scale-[0.99] hover:shadow-md ${
                  isSelected
                    ? 'border-brand-green bg-brand-green/10 ring-1 ring-brand-green'
                    : 'border-outline-variant/30 bg-white hover:bg-surface-container-low'
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
                <div className="min-w-0 flex-1 flex flex-col justify-between py-0.5">
                  <div>
                    <h4 className="font-headline text-sm font-bold leading-snug text-on-surface line-clamp-1">
                      {recipe.title}
                    </h4>
                    {!isSelected && (
                      <p className="mt-0.5 text-[11px] leading-relaxed text-on-surface-variant line-clamp-2">
                        {recipe.description}
                      </p>
                    )}
                  </div>
                  {/* Stats row */}
                  <div className="mt-2 flex items-center justify-between text-[11px] font-semibold">
                    <span className="flex items-center gap-0.5 text-brand-green">
                      <span className="material-symbols-outlined text-xs" aria-hidden="true">
                        schedule
                      </span>
                      {totalMinutes} min
                    </span>
                    {recipe.nutritionalValues && (
                      <div className="flex items-center gap-2">
                        <span className="text-on-surface font-bold">
                          {recipe.nutritionalValues.calories} kcal
                        </span>
                        <span className="rounded border border-outline-variant/30 bg-surface-container px-2 py-0.5 text-[10px] font-bold text-on-surface">
                          {recipe.nutritionalValues.protein}g prot
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Incremental pagination ("Cargar más") */}
      {search && search.hasMore && (
        <div className="pt-2 pb-4 text-center">
          <button
            type="button"
            onClick={search.loadMore}
            disabled={search.isFetchingMore}
            aria-label="Cargar más recetas"
            className="w-full rounded-xl border border-outline-variant/50 bg-white py-3 text-xs font-bold text-on-surface shadow-sm transition-all hover:bg-surface-container-low active:scale-[0.99] disabled:opacity-60"
          >
            {search.isFetchingMore ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand-green border-t-transparent" />
                <span>Cargando más recetas...</span>
              </span>
            ) : (
              'Cargar más recetas'
            )}
          </button>
        </div>
      )}

      {/* FAB — mobile only */}
      <button
        type="button"
        onClick={onCreateRecipe}
        aria-label={CREATE_RECIPE_LABEL}
        className="fixed bottom-24 right-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand-green text-2xl font-semibold text-on-primary shadow-lg transition-all hover:opacity-90 active:scale-95 md:hidden"
      >
        <span className="material-symbols-outlined text-2xl">add</span>
      </button>
    </div>
  );
}
