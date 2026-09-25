import { DesktopRecipeDetail } from '../components/detail/DesktopRecipeDetail';
import { MobileRecipeDetail } from '../components/detail/MobileRecipeDetail';
import {
  RecipeDetailError,
  RecipeDetailNotFound,
  RecipeDetailSkeleton,
} from '../components/detail/RecipeDetailStates';
import { useRecipeDetailController } from '../hooks/useRecipeDetailController';

const GENERIC_ERROR_MESSAGE = 'No pudimos cargar esta receta. Intentá de nuevo.';

export type RecipeDetailPageProps = {
  inLayout?: boolean;
};

export function RecipeDetailPage({ inLayout = false }: RecipeDetailPageProps = {}) {
  const controller = useRecipeDetailController();

  if (controller.status === 'loading') {
    return <RecipeDetailSkeleton />;
  }

  if (controller.status === 'notFound') {
    return <RecipeDetailNotFound />;
  }

  if (!controller.recipe) {
    return (
      <RecipeDetailError
        message={controller.errorMessage ?? GENERIC_ERROR_MESSAGE}
        onRetry={controller.retry}
      />
    );
  }

  if (!controller.effectiveIsDesktop) {
    return (
      <MobileRecipeDetail
        recipe={controller.recipe}
        status={controller.status}
        errorMessage={controller.errorMessage}
        modalKind={controller.modalKind}
        isSavingRecipe={controller.isSavingRecipe}
        setIsSavingRecipe={controller.setIsSavingRecipe}
        closeDetail={controller.closeDetail}
        openEdit={controller.openEdit}
        openDelete={controller.openDelete}
        closeModal={controller.closeModal}
        retry={controller.retry}
        deleteConfirmDialog={controller.deleteConfirmDialog}
        catalogIngredients={controller.catalogIngredients}
        catalogStatus={controller.catalogStatus}
      />
    );
  }

  return (
    <DesktopRecipeDetail
      inLayout={inLayout}
      recipe={controller.recipe}
      status={controller.status}
      errorMessage={controller.errorMessage}
      panelMode={controller.panelMode}
      setPanelMode={controller.setPanelMode}
      modalKind={controller.modalKind}
      setModalKind={controller.setModalKind}
      closeModal={controller.closeModal}
      openEdit={controller.openEdit}
      openDelete={controller.openDelete}
      retry={controller.retry}
      navigate={controller.navigate}
      isSavingRecipe={controller.isSavingRecipe}
      setIsSavingRecipe={controller.setIsSavingRecipe}
      isSavingIngredient={controller.isSavingIngredient}
      setIsSavingIngredient={controller.setIsSavingIngredient}
      deleteConfirmDialog={controller.deleteConfirmDialog}
      catalogIngredients={controller.catalogIngredients}
      catalogStatus={controller.catalogStatus}
      refetchIngredients={controller.refetchIngredients}
    />
  );
}
