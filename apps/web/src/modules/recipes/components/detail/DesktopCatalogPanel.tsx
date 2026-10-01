import type { Recipe } from '../../../../services/recipeService';
import { RecipeCatalogList } from '../RecipeCatalogList';
import type { UseRecipeSearchResult } from '../../hooks/useRecipeSearch';

export type DesktopCatalogPanelProps = {
  catalog: {
    recipes: Recipe[];
    status: 'loading' | 'empty' | 'error' | 'success';
    errorMessage: string | null;
    retry: () => void;
    refetch: () => void;
  };
  selectedId: string | null;
  onSelectRecipe: (id: string) => void;
  onCreateRecipe: () => void;
  searchTerm: string;
  onSearchTermChange: (term: string) => void;
  searchHook?: UseRecipeSearchResult;
};

export function DesktopCatalogPanel({
  catalog,
  selectedId,
  onSelectRecipe,
  onCreateRecipe,
  searchTerm,
  onSearchTermChange,
  searchHook,
}: DesktopCatalogPanelProps) {
  return (
    <section aria-label="Catálogo de recetas" className="col-span-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-headline text-2xl font-bold text-on-surface">Catálogo de Recetas</h2>
          <p className="text-xs font-medium text-on-surface-variant">
            Gestión integral de recetas e ingredientes nutricionales
          </p>
        </div>
        <button
          type="button"
          onClick={catalog.refetch}
          className="flex items-center gap-1 text-xs font-bold text-brand-green hover:underline"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-xs">
            refresh
          </span>
          Actualizar
        </button>
      </div>

      <RecipeCatalogList
        recipes={catalog.recipes}
        status={catalog.status}
        errorMessage={catalog.errorMessage}
        onRetry={catalog.retry}
        onRefresh={catalog.refetch}
        selectedId={selectedId}
        onSelectRecipe={onSelectRecipe}
        onCreateRecipe={onCreateRecipe}
        hideSearch={false}
        hideHeader={true}
        searchTerm={searchTerm}
        onSearchTermChange={onSearchTermChange}
        search={searchHook}
      />
    </section>
  );
}
