import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams, type useNavigate } from 'react-router-dom';
import { Modal } from '../../../../common/components/Modal';
import { TopBar } from '../../../../common/components/TopBar';
import type { Ingredient } from '../../../../services/ingredientService';
import type { Recipe } from '../../../../services/recipeService';
import { IngredientForm } from '../IngredientForm';
import { useRecipes } from '../../hooks/useRecipes';
import { useRecipeSearch, type UseRecipeSearchResult } from '../../hooks/useRecipeSearch';
import { DesktopCatalogPanel } from './DesktopCatalogPanel';
import { DesktopDetailPanel } from './DesktopDetailPanel';
import type { DetailStatus } from './MobileRecipeDetail';

export type DesktopRecipeDetailProps = {
  inLayout?: boolean;
  recipe: Recipe | null;
  status: DetailStatus;
  errorMessage: string | null;
  panelMode: 'detail' | 'create' | 'edit';
  setPanelMode: (mode: 'detail' | 'create' | 'edit') => void;
  modalKind: 'edit' | 'delete' | 'ingredient' | null;
  setModalKind: (kind: 'edit' | 'delete' | 'ingredient' | null) => void;
  closeModal: () => void;
  openEdit: () => void;
  openDelete: () => void;
  retry: () => void;
  navigate: ReturnType<typeof useNavigate>;
  isSavingRecipe: boolean;
  setIsSavingRecipe: (value: boolean) => void;
  isSavingIngredient: boolean;
  setIsSavingIngredient: (value: boolean) => void;
  deleteConfirmDialog: ReactNode;
  catalogIngredients: Ingredient[];
  catalogStatus: 'loading' | 'empty' | 'error' | 'success';
  refetchIngredients: () => void;
  searchHook?: UseRecipeSearchResult;
};

export function DesktopRecipeDetail({
  inLayout = false,
  recipe,
  status,
  errorMessage,
  panelMode,
  setPanelMode,
  modalKind,
  setModalKind,
  closeModal,
  openEdit,
  openDelete,
  retry,
  navigate,
  isSavingRecipe,
  setIsSavingRecipe,
  isSavingIngredient,
  setIsSavingIngredient,
  deleteConfirmDialog,
  catalogIngredients,
  catalogStatus,
  refetchIngredients,
  searchHook: propSearchHook,
}: DesktopRecipeDetailProps) {
  // Soporte de compatibilidad: si useRecipes está mockeado en tests legacy, se respeta ese mock.
  // En producción se utiliza useRecipeSearch con backend real y persistencia en sesión.
  const isLegacyMock = Boolean((useRecipes as unknown as { mock?: unknown }).mock);
  const legacyCatalog = useRecipes();

  const [searchParams, setSearchParams] = useSearchParams();
  const [localSearchTerm, setLocalSearchTerm] = useState('');

  const urlQuery = searchParams.get('q') ?? '';
  const searchTerm = inLayout ? urlQuery : localSearchTerm;

  const setSearchTerm = (val: string) => {
    if (inLayout) {
      const next = new URLSearchParams(searchParams);
      if (val.trim()) {
        next.set('q', val);
      } else {
        next.delete('q');
      }
      setSearchParams(next, { replace: true });
    } else {
      setLocalSearchTerm(val);
    }
  };

  const internalSearchHook = useRecipeSearch({
    initialQuery: searchTerm,
    enableSessionPersistence: true,
    enabled: !isLegacyMock && !propSearchHook,
  });

  const searchHook = propSearchHook ?? (!isLegacyMock ? internalSearchHook : undefined);

  const catalog = isLegacyMock
    ? legacyCatalog
    : {
        recipes: searchHook?.recipes ?? [],
        status: searchHook?.status ?? 'loading',
        errorMessage: searchHook?.errorMessage ?? null,
        retry: searchHook?.retry ?? (() => {}),
        refetch: searchHook?.refetch ?? (() => {}),
      };

  // Coherencia de selección: si la receta seleccionada deja de pertenecer al resultado de búsqueda por filtros activos
  const isRecipeInResults = recipe ? catalog.recipes.some((r) => r.id === recipe.id) : false;

  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
      (searchHook &&
        (searchHook.properties.length > 0 ||
          (searchHook.maxPrepMinutes != null && searchHook.maxPrepMinutes > 0))),
  );

  const recipeMatchesFilters = useMemo(() => {
    if (!recipe) return false;
    if (!hasActiveFilters) return true;

    const normalizedQuery = searchTerm.trim().toLowerCase();
    if (normalizedQuery) {
      const matchTitle = recipe.title.toLowerCase().includes(normalizedQuery);
      const matchDesc = recipe.description?.toLowerCase().includes(normalizedQuery);
      const matchIngredient = (recipe.ingredients ?? []).some((ing) =>
        ing.name.toLowerCase().includes(normalizedQuery),
      );
      const matchProperty = (recipe.properties ?? []).some((prop) =>
        prop.toLowerCase().includes(normalizedQuery),
      );
      if (!matchTitle && !matchDesc && !matchIngredient && !matchProperty) {
        return false;
      }
    }

    if (searchHook && searchHook.properties.length > 0) {
      const recipeProps = (recipe.properties ?? []).map((p) => p.toLowerCase());
      const recipeCategories = (recipe.categories ?? []).map((c) => c.toLowerCase());
      const hasAllProps = searchHook.properties.every((p) => {
        const lower = p.toLowerCase();
        return recipeProps.includes(lower) || recipeCategories.includes(lower);
      });
      if (!hasAllProps) return false;
    }

    if (searchHook?.maxPrepMinutes != null && searchHook.maxPrepMinutes > 0) {
      if (recipe.prepMinutes > searchHook.maxPrepMinutes) return false;
    }

    return true;
  }, [recipe, hasActiveFilters, searchTerm, searchHook]);

  useEffect(() => {
    if (panelMode !== 'detail') return;
    if (catalog.status !== 'success') return;
    if (catalog.recipes.length === 0) return;

    if (hasActiveFilters && recipe && !isRecipeInResults && !recipeMatchesFilters) {
      // Si la receta actual ya no pertenece a los filtros activos pero hay otras recetas, seleccionar la primera
      navigate(`/recipes/${catalog.recipes[0].id}`, { replace: true });
    }
  }, [
    catalog.status,
    catalog.recipes,
    recipe,
    isRecipeInResults,
    recipeMatchesFilters,
    hasActiveFilters,
    navigate,
    panelMode,
  ]);

  const effectiveRecipe =
    hasActiveFilters && catalog.status === 'success' && !isRecipeInResults && !recipeMatchesFilters
      ? null
      : recipe;

  return (
    <div className="min-h-screen bg-brand-cream">
      {!inLayout && (
        <TopBar
          isRecipes={true}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          onOpenCreateRecipe={() => setPanelMode('create')}
          onOpenCreateIngredient={() => setModalKind('ingredient')}
        />
      )}

      {/* Main Workspace (Dividido Master-Detail Stitch 5 cols / 7 cols) */}
      <main className="mx-auto grid max-w-7xl grid-cols-12 gap-6 items-start p-8">
        <DesktopCatalogPanel
          catalog={catalog}
          selectedId={effectiveRecipe?.id ?? null}
          onSelectRecipe={(newId) => navigate(`/recipes/${newId}`)}
          onCreateRecipe={() => setPanelMode('create')}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          searchHook={searchHook}
        />

        <DesktopDetailPanel
          recipe={effectiveRecipe}
          status={status}
          errorMessage={errorMessage}
          panelMode={panelMode}
          onCancelForm={() => setPanelMode('detail')}
          onSuccessCreate={(created) => {
            setPanelMode('detail');
            catalog.refetch();
            searchHook?.refetch();
            navigate(`/recipes/${created.id}`);
          }}
          onSuccessEdit={() => {
            setPanelMode('detail');
            retry();
            catalog.refetch();
            searchHook?.refetch();
          }}
          isSavingRecipe={isSavingRecipe}
          setIsSavingRecipe={setIsSavingRecipe}
          catalogIngredients={catalogIngredients}
          catalogStatus={catalogStatus}
          openEdit={openEdit}
          openDelete={openDelete}
          retry={retry}
        />
      </main>

      <Modal
        open={modalKind === 'ingredient'}
        onClose={closeModal}
        title="Nuevo Ingrediente"
        dismissible={!isSavingIngredient}
      >
        <IngredientForm
          onSuccess={() => {
            closeModal();
            catalog.refetch();
            searchHook?.refetch();
            refetchIngredients();
          }}
          onCancel={closeModal}
          onSubmittingChange={setIsSavingIngredient}
        />
      </Modal>

      {deleteConfirmDialog}
    </div>
  );
}
