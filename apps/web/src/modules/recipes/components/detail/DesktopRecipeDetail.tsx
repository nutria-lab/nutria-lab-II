import { useState, type ReactNode } from 'react';
import { useSearchParams, type useNavigate } from 'react-router-dom';
import { Banner } from '../../../../common/components/Banner';
import { Modal } from '../../../../common/components/Modal';
import { TopBar } from '../../../../common/components/TopBar';
import type { Ingredient } from '../../../../services/ingredientService';
import type { Recipe } from '../../../../services/recipeService';
import { IngredientForm } from '../IngredientForm';
import { RecipeCatalogList } from '../RecipeCatalogList';
import { RecipeForm } from '../RecipeForm';
import { useRecipes } from '../../hooks/useRecipes';
import {
  DesktopIngredientsAndSteps,
  DesktopNutritionalValues,
  DesktopRecipeHero,
} from './RecipeDetailContent';
import type { DetailStatus } from './MobileRecipeDetail';

const DETAIL_TITLE = 'Detalle de Receta';

export type DesktopRecipeDetailProps = {
  inLayout?: boolean;
  recipe: Recipe;
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
};

// Hallazgo 3 (alto, novena iteración): `useRecipes()` (usado hoy sólo para alimentar la columna
// izquierda de escritorio, `RecipeCatalogList`) se invoca ÚNICAMENTE acá, dentro del
// subcomponente de escritorio — nunca se monta en mobile, así que nunca dispara ese fetch ahí.
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
}: DesktopRecipeDetailProps) {
  // Columna izquierda de escritorio (design.md 9.2/9.5): mismo hook, misma petición que ya usa
  // `RecipesListPage` — no se pide el detalle de nuevo por este lado.
  const catalog = useRecipes();
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

  return (
    <div className="min-h-screen bg-brand-cream">
      {/* If not inside AppLayout (e.g. standalone tests), render TopBar directly */}
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
        {/* Columna Izquierda (Cols 5): Catálogo */}
        <section className="col-span-5 flex flex-col gap-4">
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
              <span aria-hidden="true" className="material-symbols-outlined text-xs">refresh</span>
              Actualizar
            </button>
          </div>

          <RecipeCatalogList
            recipes={catalog.recipes}
            status={catalog.status}
            errorMessage={catalog.errorMessage}
            onRetry={catalog.retry}
            onRefresh={catalog.refetch}
            selectedId={recipe.id}
            onSelectRecipe={(newId) => navigate(`/recipes/${newId}`)}
            onCreateRecipe={() => setPanelMode('create')}
            hideSearch={true}
            hideHeader={true}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
          />
        </section>

        {/* Columna Derecha (Cols 7): Detalle o Formulario */}
        <section className="col-span-7 bg-white rounded-2xl border border-outline-variant/30 p-6 shadow-sm min-h-[600px] flex flex-col justify-between">
          {panelMode === 'create' && (
            <RecipeForm
              mode="create"
              catalogIngredients={catalogIngredients}
              catalogStatus={catalogStatus}
              onSuccess={(created) => {
                setPanelMode('detail');
                catalog.refetch();
                navigate(`/recipes/${created.id}`);
              }}
              onCancel={() => setPanelMode('detail')}
              onSubmittingChange={setIsSavingRecipe}
            />
          )}

          {panelMode === 'edit' && (
            <RecipeForm
              mode="edit"
              initialValues={recipe}
              catalogIngredients={catalogIngredients}
              catalogStatus={catalogStatus}
              onSuccess={() => {
                setPanelMode('detail');
                retry();
                catalog.refetch();
              }}
              onCancel={() => setPanelMode('detail')}
              onSubmittingChange={setIsSavingRecipe}
            />
          )}

          {panelMode === 'detail' && (
            <div className="space-y-6">
              {status === 'error' && errorMessage && <Banner variant="error" message={errorMessage} />}
              <div className="flex items-center justify-between pb-4 border-b border-outline-variant/20">
                <h1 className="text-xs font-bold text-on-surface-variant tracking-wider uppercase flex items-center gap-1.5">
                  <span aria-hidden="true" className="material-symbols-outlined text-brand-green text-base">info</span>
                  {DETAIL_TITLE}
                </h1>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={openEdit}
                    className="flex items-center gap-1.5 rounded-xl border border-outline-variant/40 bg-surface-container px-3.5 py-1.5 text-xs font-bold text-on-surface transition-all hover:bg-surface-container-high active:scale-95"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-sm text-brand-green">edit</span>
                    <span>Modificar Receta</span>
                  </button>
                  <button
                    type="button"
                    onClick={openDelete}
                    className="flex items-center gap-1.5 rounded-xl bg-error-container/30 px-3.5 py-1.5 text-xs font-bold text-error transition-all hover:bg-error-container/60 active:scale-95"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-sm text-error">delete</span>
                    <span>Eliminar</span>
                  </button>
                </div>
              </div>

              <DesktopRecipeHero recipe={recipe} />

              <DesktopNutritionalValues recipe={recipe} />

              <DesktopIngredientsAndSteps recipe={recipe} />
            </div>
          )}
        </section>
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
