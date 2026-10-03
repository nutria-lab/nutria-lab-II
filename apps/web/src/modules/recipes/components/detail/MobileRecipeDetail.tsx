import type { ReactNode } from 'react';
import { Banner } from '../../../../common/components/Banner';
import { Modal } from '../../../../common/components/Modal';
import type { Ingredient } from '../../../../services/ingredientService';
import type { Recipe } from '../../../../services/recipeService';
import { RecipeForm } from '../RecipeForm';
import { RecipeDetailSections, RecipeImagePlaceholder } from './RecipeDetailContent';

const DETAIL_TITLE = 'Detalle de Receta';
const CLOSE_DETAIL_LABEL = 'Cerrar Detalle';

export type DetailStatus = 'loading' | 'notFound' | 'error' | 'success';

export type MobileRecipeDetailProps = {
  recipe: Recipe;
  status: DetailStatus;
  errorMessage: string | null;
  modalKind: 'edit' | 'delete' | 'ingredient' | null;
  isSavingRecipe: boolean;
  setIsSavingRecipe: (value: boolean) => void;
  closeDetail: () => void;
  openEdit: () => void;
  openDelete: () => void;
  closeModal: () => void;
  retry: () => void;
  deleteConfirmDialog: ReactNode;
  catalogIngredients: Ingredient[];
  catalogStatus: 'loading' | 'empty' | 'error' | 'success';
};

export function MobileRecipeDetail({
  recipe,
  status,
  errorMessage,
  modalKind,
  isSavingRecipe,
  setIsSavingRecipe,
  closeDetail,
  openEdit,
  openDelete,
  closeModal,
  retry,
  deleteConfirmDialog,
  catalogIngredients,
  catalogStatus,
}: MobileRecipeDetailProps) {
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:px-8">
      <div aria-hidden={modalKind !== null} className="space-y-4">
        {status === 'error' && errorMessage && <Banner variant="error" message={errorMessage} />}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={closeDetail}
            aria-label="Cerrar"
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 hover:bg-brand-cream-dark"
          >
            <span aria-hidden="true">✕</span>
          </button>
          <h1 className="font-serif text-xl font-bold text-neutral-900">{DETAIL_TITLE}</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={openEdit}
              aria-label="Editar"
              className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 hover:bg-brand-cream-dark"
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={openDelete}
              aria-label="Eliminar"
              className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 hover:bg-brand-cream-dark"
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6" />
              </svg>
            </button>
          </div>
        </div>

        <RecipeImagePlaceholder recipe={recipe} />

        <RecipeDetailSections recipe={recipe} />

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={closeDetail}
            className="min-h-[44px] rounded-lg bg-brand-cream-dark px-6 text-sm font-semibold text-neutral-700"
          >
            {CLOSE_DETAIL_LABEL}
          </button>
        </div>
      </div>

      <Modal
        open={modalKind === 'edit'}
        onClose={closeModal}
        title="Modificar Receta"
        dismissible={!isSavingRecipe}
      >
        <RecipeForm
          mode="edit"
          initialValues={recipe}
          catalogIngredients={catalogIngredients}
          catalogStatus={catalogStatus}
          onSuccess={() => {
            closeModal();
            retry();
          }}
          onCancel={closeModal}
          onSubmittingChange={setIsSavingRecipe}
        />
      </Modal>

      {deleteConfirmDialog}
    </main>
  );
}
