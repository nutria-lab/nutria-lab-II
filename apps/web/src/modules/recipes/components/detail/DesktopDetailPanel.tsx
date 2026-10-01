import { Banner } from '../../../../common/components/Banner';
import type { Ingredient } from '../../../../services/ingredientService';
import type { Recipe } from '../../../../services/recipeService';
import { RecipeForm } from '../RecipeForm';
import {
  DesktopIngredientsAndSteps,
  DesktopNutritionalValues,
  DesktopRecipeHero,
} from './RecipeDetailContent';
import {
  RecipeDetailError,
  RecipeDetailNotFound,
  RecipeDetailSkeleton,
} from './RecipeDetailStates';
import type { DetailStatus } from './MobileRecipeDetail';

const DETAIL_TITLE = 'Detalle de Receta';
const GENERIC_ERROR_MESSAGE = 'No pudimos cargar esta receta. Intentá de nuevo.';

export type DesktopDetailPanelProps = {
  recipe: Recipe | null;
  status: DetailStatus;
  errorMessage: string | null;
  panelMode: 'detail' | 'create' | 'edit';
  onCancelForm: () => void;
  onSuccessCreate: (created: Recipe) => void;
  onSuccessEdit: () => void;
  isSavingRecipe: boolean;
  setIsSavingRecipe: (value: boolean) => void;
  catalogIngredients: Ingredient[];
  catalogStatus: 'loading' | 'empty' | 'error' | 'success';
  openEdit: () => void;
  openDelete: () => void;
  retry: () => void;
};

export function DesktopDetailPanel({
  recipe,
  status,
  errorMessage,
  panelMode,
  onCancelForm,
  onSuccessCreate,
  onSuccessEdit,
  isSavingRecipe,
  setIsSavingRecipe,
  catalogIngredients,
  catalogStatus,
  openEdit,
  openDelete,
  retry,
}: DesktopDetailPanelProps) {
  return (
    <section
      aria-label="Detalle de receta"
      className="col-span-7 flex min-h-[600px] flex-col justify-between rounded-2xl border border-outline-variant/30 bg-white p-6 shadow-sm"
    >
      {panelMode === 'create' && (
        <RecipeForm
          mode="create"
          catalogIngredients={catalogIngredients}
          catalogStatus={catalogStatus}
          onSuccess={onSuccessCreate}
          onCancel={onCancelForm}
          onSubmittingChange={setIsSavingRecipe}
        />
      )}

      {panelMode === 'edit' && recipe && (
        <RecipeForm
          mode="edit"
          initialValues={recipe}
          catalogIngredients={catalogIngredients}
          catalogStatus={catalogStatus}
          onSuccess={onSuccessEdit}
          onCancel={onCancelForm}
          onSubmittingChange={setIsSavingRecipe}
        />
      )}

      {panelMode === 'detail' && (
        <>
          {status === 'loading' && <RecipeDetailSkeleton />}

          {status === 'notFound' && <RecipeDetailNotFound />}

          {status === 'error' && !recipe && (
            <RecipeDetailError
              message={errorMessage ?? GENERIC_ERROR_MESSAGE}
              onRetry={retry}
            />
          )}

          {recipe && (
            <div className="space-y-6">
              {status === 'error' && errorMessage && (
                <Banner variant="error" message={errorMessage} />
              )}
              <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4">
                <h1 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                  <span aria-hidden="true" className="material-symbols-outlined text-base text-brand-green">
                    info
                  </span>
                  {DETAIL_TITLE}
                </h1>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={openEdit}
                    className="flex items-center gap-1.5 rounded-xl border border-outline-variant/40 bg-surface-container px-3.5 py-1.5 text-xs font-bold text-on-surface transition-all hover:bg-surface-container-high active:scale-95"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-sm text-brand-green">
                      edit
                    </span>
                    <span>Modificar Receta</span>
                  </button>
                  <button
                    type="button"
                    onClick={openDelete}
                    className="flex items-center gap-1.5 rounded-xl bg-error-container/30 px-3.5 py-1.5 text-xs font-bold text-error transition-all hover:bg-error-container/60 active:scale-95"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-sm text-error">
                      delete
                    </span>
                    <span>Eliminar</span>
                  </button>
                </div>
              </div>

              <DesktopRecipeHero recipe={recipe} />
              <DesktopNutritionalValues recipe={recipe} />
              <DesktopIngredientsAndSteps recipe={recipe} />
            </div>
          )}

          {!recipe && status === 'success' && (
            <div className="py-16 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-container">
                <span className="material-symbols-outlined text-3xl text-on-surface-variant" aria-hidden="true">
                  restaurant_menu
                </span>
              </div>
              <p className="font-headline text-lg font-bold text-on-surface">Seleccioná una receta</p>
              <p className="mt-1 text-sm text-on-surface-variant">
                Elegí una receta del catálogo para ver su detalle completo.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
