import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../../../common/components/ConfirmDialog';
import { useMediaQuery } from '../../../common/hooks/useMediaQuery';
import type { Ingredient } from '../../../services/ingredientService';
import {
  recipeService,
  RecipeRequestError,
  type Recipe,
} from '../../../services/recipeService';
import { useIngredients } from './useIngredients';
import { useRecipeDetail } from './useRecipeDetail';
import type { DetailStatus } from '../components/detail/MobileRecipeDetail';

const DELETE_CONFIRM_TITLE = 'Eliminar receta';
const DELETE_CONFIRM_MESSAGE =
  '¿Seguro que querés eliminar esta receta? Esta acción no se puede deshacer.';
const DELETE_CONFLICT_ERROR =
  'No pudimos eliminar la receta: puede que ya no exista o haya cambiado. Volvé a intentarlo.';
const DELETE_CONNECTIVITY_ERROR = 'No pudimos conectar. Revisá tu conexión e intentá de nuevo.';
const DELETE_UNEXPECTED_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';

const DESKTOP_MEDIA_QUERY = '(min-width: 768px)';

function deleteErrorMessage(error: unknown): string {
  if (error instanceof RecipeRequestError) {
    if (error.kind === 'conflict') {
      return DELETE_CONFLICT_ERROR;
    }
    if (error.kind === 'network' || error.kind === 'timeout') {
      return DELETE_CONNECTIVITY_ERROR;
    }
    return DELETE_UNEXPECTED_ERROR;
  }
  return DELETE_UNEXPECTED_ERROR;
}

export type RecipeDetailController = {
  recipe: Recipe | null;
  status: DetailStatus;
  errorMessage: string | null;
  retry: () => void;
  effectiveIsDesktop: boolean;
  modalKind: 'edit' | 'delete' | 'ingredient' | null;
  setModalKind: (kind: 'edit' | 'delete' | 'ingredient' | null) => void;
  panelMode: 'detail' | 'create' | 'edit';
  setPanelMode: (mode: 'detail' | 'create' | 'edit') => void;
  closeDetail: () => void;
  openEdit: () => void;
  openDelete: () => void;
  closeModal: () => void;
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

export function useRecipeDetailController(): RecipeDetailController {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { recipe, status, errorMessage, retry } = useRecipeDetail(id ?? '');

  const {
    ingredients: catalogIngredients,
    status: catalogStatus,
    refetch: refetchIngredients,
  } = useIngredients();

  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);

  const urlPanel = searchParams.get('panel');
  const urlModal = searchParams.get('modal');

  const [modalKind, setModalKind] = useState<'edit' | 'delete' | 'ingredient' | null>(
    urlModal === 'ingredient' ? 'ingredient' : null,
  );
  const [panelMode, setPanelMode] = useState<'detail' | 'create' | 'edit'>(
    urlPanel === 'create' || urlPanel === 'edit' ? urlPanel : 'detail',
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [isSavingRecipe, setIsSavingRecipe] = useState(false);
  const [isSavingIngredient, setIsSavingIngredient] = useState(false);

  // Sync state if URL changes
  useEffect(() => {
    if (urlPanel === 'create' || urlPanel === 'edit') {
      setPanelMode(urlPanel);
    }
  }, [urlPanel]);

  useEffect(() => {
    if (urlModal === 'ingredient') {
      setModalKind('ingredient');
    }
  }, [urlModal]);

  // Freeze desktop/mobile branch during inline recipe form editing
  const formOpen = panelMode !== 'detail';
  const [frozenIsDesktop, setFrozenIsDesktop] = useState<boolean | null>(null);
  if (formOpen && frozenIsDesktop === null) {
    setFrozenIsDesktop(isDesktop);
  } else if (!formOpen && frozenIsDesktop !== null) {
    setFrozenIsDesktop(null);
  }
  const effectiveIsDesktop = frozenIsDesktop ?? isDesktop;

  useEffect(() => {
    setPanelMode('detail');
  }, [id]);

  function closeDetail() {
    navigate('/recipes');
  }

  function openEdit() {
    if (effectiveIsDesktop) {
      handleSetPanelMode('edit');
    } else {
      handleSetModalKind('edit');
    }
  }

  function openDelete() {
    setDeleteError(null);
    handleSetModalKind('delete');
  }

  function closeModal() {
    setModalKind(null);
    setDeleteError(null);
    if (searchParams.get('modal')) {
      const next = new URLSearchParams(searchParams);
      next.delete('modal');
      setSearchParams(next, { replace: true });
    }
  }

  function handleSetPanelMode(mode: 'detail' | 'create' | 'edit') {
    setPanelMode(mode);
    if (mode === 'detail' && searchParams.get('panel')) {
      const next = new URLSearchParams(searchParams);
      next.delete('panel');
      setSearchParams(next, { replace: true });
    }
  }

  function handleSetModalKind(kind: 'edit' | 'delete' | 'ingredient' | null) {
    setModalKind(kind);
    if (!kind && searchParams.get('modal')) {
      const next = new URLSearchParams(searchParams);
      next.delete('modal');
      setSearchParams(next, { replace: true });
    }
  }

  async function handleDelete() {
    if (deletingRef.current || !recipe) {
      return;
    }

    deletingRef.current = true;
    setDeleting(true);
    try {
      await recipeService.remove(recipe.id);
      navigate('/recipes');
    } catch (error) {
      setDeleteError(deleteErrorMessage(error));
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  const deleteConfirmDialog = (
    <ConfirmDialog
      open={modalKind === 'delete'}
      title={DELETE_CONFIRM_TITLE}
      message={deleteError ?? DELETE_CONFIRM_MESSAGE}
      confirmLabel="Eliminar"
      onConfirm={handleDelete}
      onCancel={closeModal}
      isConfirming={deleting}
    />
  );

  return {
    recipe,
    status,
    errorMessage,
    retry,
    effectiveIsDesktop,
    modalKind,
    setModalKind: handleSetModalKind,
    panelMode,
    setPanelMode: handleSetPanelMode,
    closeDetail,
    openEdit,
    openDelete,
    closeModal,
    navigate,
    isSavingRecipe,
    setIsSavingRecipe,
    isSavingIngredient,
    setIsSavingIngredient,
    deleteConfirmDialog,
    catalogIngredients,
    catalogStatus,
    refetchIngredients,
  };
}
