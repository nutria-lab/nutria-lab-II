import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Banner } from '../../../common/components/Banner';
import { ConfirmDialog } from '../../../common/components/ConfirmDialog';
import { Modal } from '../../../common/components/Modal';
import { useMediaQuery } from '../../../common/hooks/useMediaQuery';
import { recipeService, RecipeRequestError, type Recipe } from '../../../services/recipeService';
import { IngredientForm } from '../components/IngredientForm';
import { RecipeCatalogList } from '../components/RecipeCatalogList';
import { RecipeForm } from '../components/RecipeForm';
import { useIngredients } from '../hooks/useIngredients';
import { useRecipeDetail } from '../hooks/useRecipeDetail';
import { useRecipes } from '../hooks/useRecipes';
import { RECIPE_CATEGORY_LABELS } from '../labels';
import type { Ingredient } from '../../../services/ingredientService';

const DETAIL_TITLE = 'Detalle de Receta';
const NOT_FOUND_MESSAGE = 'Esta receta ya no está disponible. Puede que haya sido eliminada.';
const BACK_TO_LIST_LABEL = 'Volver al listado';
const GENERIC_ERROR_MESSAGE = 'No pudimos cargar esta receta. Intentá de nuevo.';
const RETRY_LABEL = 'Reintentar';
const CLOSE_DETAIL_LABEL = 'Cerrar Detalle';
const DELETE_CONFIRM_TITLE = 'Eliminar receta';
const DELETE_CONFIRM_MESSAGE =
  '¿Seguro que querés eliminar esta receta? Esta acción no se puede deshacer.';
const DELETE_CONFLICT_ERROR =
  'No pudimos eliminar la receta: puede que ya no exista o haya cambiado. Volvé a intentarlo.';
const DELETE_CONNECTIVITY_ERROR = 'No pudimos conectar. Revisá tu conexión e intentá de nuevo.';
const DELETE_UNEXPECTED_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';
// NUT-20 (octava iteración) — adaptación tablet/desktop (design.md sección 9.2), mismo
// breakpoint `md:` ya usado por `Sidebar.tsx`/`AppLayout.tsx`/`BottomNavigation.tsx`.
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

function LoadingSkeleton() {
  return (
    <div
      data-testid="recipe-detail-skeleton"
      aria-busy="true"
      aria-live="polite"
      className="mx-auto max-w-3xl animate-pulse space-y-4 px-4 py-6 md:px-8"
    >
      <div className="h-48 w-full rounded-2xl bg-surface-container" />
      <div className="h-6 w-2/3 rounded bg-surface-container" />
      <div className="h-24 w-full rounded bg-surface-container" />
    </div>
  );
}

function NotFoundState() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 text-center md:px-8">
      <p className="font-headline text-lg font-semibold text-on-surface">{NOT_FOUND_MESSAGE}</p>
      <Link
        to="/recipes"
        className="mt-4 inline-block min-h-[44px] rounded-xl bg-brand-green px-6 py-3 text-sm font-semibold text-on-primary"
      >
        {BACK_TO_LIST_LABEL}
      </Link>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 text-center md:px-8">
      <p className="font-headline text-lg font-semibold text-on-surface">Algo salió mal</p>
      <p className="mt-2 text-sm text-on-surface-variant">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 min-h-[44px] rounded-xl bg-brand-green px-6 text-sm font-semibold text-on-primary"
      >
        {RETRY_LABEL}
      </button>
    </div>
  );
}


// Skeleton/placeholder estático de imagen (design.md sección 2.3) con el badge de categoría
// superpuesto — compartido entre la variante mobile y la columna derecha de escritorio.
function RecipeImagePlaceholder({ recipe }: { recipe: Recipe }) {
  const primaryCategoryRaw = (recipe.categories ?? [])[0];
  const primaryCategory = primaryCategoryRaw
    ? RECIPE_CATEGORY_LABELS[primaryCategoryRaw]
    : 'Sin categoría';
  return (
    <div className="relative h-48 w-full overflow-hidden rounded-2xl bg-surface-container">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-on-surface/50 to-transparent"
      />
      <div className="absolute bottom-3 left-3 right-3 space-y-1">
        <div>
          <span className="rounded-full bg-tertiary-container/80 px-3 py-1 text-xs font-bold uppercase tracking-wide text-on-tertiary-container">
            {primaryCategory}
          </span>
        </div>
        <h2 className="font-headline text-lg font-bold text-white">{recipe.title}</h2>
      </div>
    </div>
  );
}


function RecipeDetailSections({ recipe }: { recipe: Recipe }) {
  const totalMinutes = recipe.prepMinutes + recipe.cookMinutes;
  const recipeProperties = recipe.properties ?? [];

  return (
    <>
      {/* Stats row */}
      <div className="flex flex-wrap gap-4 text-sm text-on-surface-variant">
        <span className="flex flex-col items-start gap-0.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant/70">
            Tiempo
          </span>
          <span className="font-semibold text-on-surface">{totalMinutes} min</span>
        </span>
        {Boolean(recipe.nutritionalValues) ? (
          <>
            <span className="flex flex-col items-start gap-0.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant/70">
                Calorías
              </span>
              <span className="font-semibold text-on-surface">
                {recipe.nutritionalValues!.calories} kcal
              </span>
            </span>
            <span className="flex flex-col items-start gap-0.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant/70">
                Proteína
              </span>
              <span className="font-semibold text-on-surface">
                {recipe.nutritionalValues!.protein} g
              </span>
            </span>
            <span className="flex flex-col items-start gap-0.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant/70">
                Carbos
              </span>
              <span className="font-semibold text-on-surface">
                {recipe.nutritionalValues!.carbs} g
              </span>
            </span>
          </>
        ) : (
          <span className="text-on-surface-variant">Valores nutricionales no especificados</span>
        )}
      </div>

      <section>
        <h2 className="font-headline text-lg font-semibold text-on-surface">Descripción</h2>
        <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">{recipe.description}</p>
      </section>

      <section>
        <h2 className="font-headline text-lg font-semibold text-on-surface">
          {`Ingredientes (${recipe.ingredients.length})`}
        </h2>
        <ul className="mt-2 space-y-2 text-sm text-on-surface">
          {recipe.ingredients.map((item, index) => (
            <li
              key={`${item.name}-${index}`}
              className="flex items-center justify-between rounded-xl border border-outline-variant/30 bg-white p-3 shadow-sm"
            >
              <span>{item.name}</span>
              <span className="font-semibold text-brand-green">{`${item.quantity} ${item.unit}`}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-headline text-lg font-semibold text-on-surface">Pasos de Preparación</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-on-surface-variant">
          {recipe.instructions.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </section>

      {recipeProperties.length > 0 && (
        <section>
          <h2 className="font-headline text-lg font-semibold text-on-surface">
            Propiedades y Restricciones
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {recipeProperties.map((property) => (
              <li
                key={property}
                className="rounded-full bg-surface-container px-3 py-1 text-xs font-bold uppercase tracking-wide text-on-surface-variant"
              >
                {property}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}


type DetailStatus = 'loading' | 'notFound' | 'error' | 'success';

type MobileRecipeDetailProps = {
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
  // NUT-20 (bug real reportado por la PO) — `RecipeForm` ya no llama a `useIngredients()`
  // internamente; el catálogo lo controla `RecipeDetailPage` (nivel de página) y se lo pasa por
  // props a este subcomponente.
  catalogIngredients: Ingredient[];
  catalogStatus: 'loading' | 'empty' | 'error' | 'success';
};

// Hallazgo 3 (alto, novena iteración): variante mobile, extraída para que `useRecipes()` (sólo
// necesario para la columna izquierda de escritorio) nunca se invoque cuando esta variante es la
// que se monta.
function MobileRecipeDetail({
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

type DesktopRecipeDetailProps = {
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
  // NUT-20 (bug real reportado por la PO) — mismo catálogo de `RecipeDetailPage`, pasado por
  // props a ambos `RecipeForm` (create/edit) del panel derecho; `refetchIngredients` se invoca
  // también al crear un ingrediente nuevo desde la columna izquierda, para que el `RecipeForm`
  // del panel derecho (que nunca se desmonta) vea el catálogo actualizado sin recargar la página.
  catalogIngredients: Ingredient[];
  catalogStatus: 'loading' | 'empty' | 'error' | 'success';
  refetchIngredients: () => void;
};

// Hallazgo 3 (alto, novena iteración): `useRecipes()` (usado hoy sólo para alimentar la columna
// izquierda de escritorio, `RecipeCatalogList`) se invoca ÚNICAMENTE acá, dentro del
// subcomponente de escritorio — nunca se monta en mobile, así que nunca dispara ese fetch ahí.
function DesktopRecipeDetail({
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

  return (
    <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6 md:px-8">
      <div className="w-full max-w-sm shrink-0 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="font-serif text-2xl font-bold text-neutral-900">Catálogo de Recetas</h1>
            <p className="text-sm text-neutral-500">
              Gestión integral de recetas e ingredientes nutricionales
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setModalKind('ingredient')}
              className="min-h-[44px] rounded-lg bg-brand-cream-dark px-4 text-sm font-semibold text-neutral-700"
            >
              + Ingrediente
            </button>
            <button
              type="button"
              onClick={() => setPanelMode('create')}
              className="min-h-[44px] rounded-lg bg-brand-green px-4 text-sm font-semibold text-white"
            >
              Nueva Receta
            </button>
          </div>
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
        />
      </div>

      <div className="flex-1 space-y-4">
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
          <>
            {status === 'error' && errorMessage && <Banner variant="error" message={errorMessage} />}
            <div className="flex items-center justify-between">
              <h1 className="font-serif text-xl font-bold text-neutral-900">{DETAIL_TITLE}</h1>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openEdit}
                  className="min-h-[44px] rounded-lg bg-brand-cream-dark px-4 text-sm font-semibold text-neutral-700"
                >
                  Modificar Receta
                </button>
                <button
                  type="button"
                  onClick={openDelete}
                  className="min-h-[44px] rounded-lg bg-red-50 px-4 text-sm font-semibold text-red-700"
                >
                  Eliminar
                </button>
              </div>
            </div>

            <RecipeImagePlaceholder recipe={recipe} />

            <RecipeDetailSections recipe={recipe} />
          </>
        )}
      </div>

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

// NUT-20 (quinta iteración): pantalla de detalle de receta (design.md sección 4.1/4.2). Ver
// `RecipeDetailPage.test.tsx` para la fuente de verdad exacta de nombres accesibles, testids y
// mensajes. NUT-20 (octava iteración): adaptación tablet/desktop (design.md sección 9) —
// composición por breakpoint sobre exactamente los mismos hooks/componentes, sin lógica nueva.
// NUT-20 (novena iteración): el componente principal sólo decide, según `isDesktop` (congelado
// mientras haya un formulario de receta abierto, Hallazgo 2), cuál de los dos subcomponentes
// (`MobileRecipeDetail`/`DesktopRecipeDetail`) montar — `useRecipes()` vive únicamente dentro del
// segundo (Hallazgo 3).
export function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { recipe, status, errorMessage, retry } = useRecipeDetail(id ?? '');
  // NUT-20 (bug real reportado por la PO) — se llama una única vez a nivel de página (tanto la
  // variante mobile como la de escritorio consumen el mismo catálogo vía props), en reemplazo
  // del `useIngredients()` interno que tenía `RecipeForm` antes de este fix.
  const {
    ingredients: catalogIngredients,
    status: catalogStatus,
    refetch: refetchIngredients,
  } = useIngredients();
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);

  const [modalKind, setModalKind] = useState<'edit' | 'delete' | 'ingredient' | null>(null);
  // Estado del panel derecho de escritorio (design.md 9.2/9.5): nunca se usa en mobile.
  const [panelMode, setPanelMode] = useState<'detail' | 'create' | 'edit'>('detail');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Guarda de reentrancia sincrónica (Hallazgo 4, cuarto review): `deleting` (estado de React)
  // no alcanza a reflejarse antes de un segundo `fireEvent.click` disparado dentro del mismo
  // `act()` síncrono (React sólo aplica actualizaciones de estado pendientes al salir del
  // bloque) — un `ref` se lee/escribe de forma inmediata, sin esperar al próximo render.
  const deletingRef = useRef(false);
  // Hallazgo 2 (bloqueante, cuarto review): el `Modal`/panel de edición deja de ser cerrable
  // mientras `RecipeForm` está enviando la edición.
  const [isSavingRecipe, setIsSavingRecipe] = useState(false);
  const [isSavingIngredient, setIsSavingIngredient] = useState(false);

  // Hallazgo 2 (alto, novena iteración): freeze de qué rama (mobile/escritorio) se renderiza
  // mientras haya un formulario de receta abierto (`panelMode !== 'detail'`), ignorando cambios
  // de `isDesktop` (p. ej. un resize/rotación) hasta que el formulario se cierre.
  const formOpen = panelMode !== 'detail';
  const [frozenIsDesktop, setFrozenIsDesktop] = useState<boolean | null>(null);
  if (formOpen && frozenIsDesktop === null) {
    setFrozenIsDesktop(isDesktop);
  } else if (!formOpen && frozenIsDesktop !== null) {
    setFrozenIsDesktop(null);
  }
  const effectiveIsDesktop = frozenIsDesktop ?? isDesktop;

  // Al navegar a otra receta desde la columna izquierda de escritorio, el panel derecho vuelve
  // a mostrar el detalle (no queda "pegado" en un formulario de creación/edición de la receta
  // anterior).
  useEffect(() => {
    setPanelMode('detail');
  }, [id]);

  function closeDetail() {
    navigate('/recipes');
  }

  function openEdit() {
    if (effectiveIsDesktop) {
      // Composición de escritorio (design.md 9.3): `RecipeForm` inline en el panel derecho,
      // sin `Modal`.
      setPanelMode('edit');
    } else {
      setModalKind('edit');
    }
  }

  function openDelete() {
    setDeleteError(null);
    setModalKind('delete');
  }

  function closeModal() {
    setModalKind(null);
    setDeleteError(null);
  }

  async function handleDelete() {
    // Hallazgo 4 (alto, cuarto review): mismo patrón de guarda de reentrancia que
    // `RecipeForm.handleSubmit`/`IngredientForm.handleSubmit` — protege contra dos clicks
    // despachados antes de que React llegue a reflejar `disabled` en el DOM real. Se usa un
    // `ref` (no sólo el estado `deleting`) porque el estado de React no está disponible de
    // forma sincrónica entre dos llamadas despachadas en el mismo batch.
    if (deletingRef.current) {
      return;
    }

    if (!recipe) {
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

  if (status === 'loading') {
    return <LoadingSkeleton />;
  }

  if (status === 'notFound') {
    return <NotFoundState />;
  }

  // Hallazgo 3 (alto, cuarto review): si ya había una receta cargada, un error posterior
  // (p. ej. el refetch de verificación tras editar) no debe reemplazar el contenido por la
  // pantalla completa de error — se muestra la receta con un banner de error superpuesto,
  // mismo patrón que `RecipesListPage` para `status === 'error' && recipes.length > 0`. Sólo
  // cuando nunca hubo datos (`recipe` es `null`) se mantiene la pantalla completa de error.
  if (!recipe) {
    return <ErrorState message={errorMessage ?? GENERIC_ERROR_MESSAGE} onRetry={retry} />;
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

  // Hallazgo 2/3 (novena iteración): la rama a montar se decide con `effectiveIsDesktop`
  // (congelado mientras haya un formulario de receta abierto), y `useRecipes()` sólo se invoca
  // dentro de `DesktopRecipeDetail`, nunca en `MobileRecipeDetail`.
  if (!effectiveIsDesktop) {
    return (
      <MobileRecipeDetail
        recipe={recipe}
        status={status}
        errorMessage={errorMessage}
        modalKind={modalKind}
        isSavingRecipe={isSavingRecipe}
        setIsSavingRecipe={setIsSavingRecipe}
        closeDetail={closeDetail}
        openEdit={openEdit}
        openDelete={openDelete}
        closeModal={closeModal}
        retry={retry}
        deleteConfirmDialog={deleteConfirmDialog}
        catalogIngredients={catalogIngredients}
        catalogStatus={catalogStatus}
      />
    );
  }

  return (
    <DesktopRecipeDetail
      recipe={recipe}
      status={status}
      errorMessage={errorMessage}
      panelMode={panelMode}
      setPanelMode={setPanelMode}
      modalKind={modalKind}
      setModalKind={setModalKind}
      closeModal={closeModal}
      openEdit={openEdit}
      openDelete={openDelete}
      retry={retry}
      navigate={navigate}
      isSavingRecipe={isSavingRecipe}
      setIsSavingRecipe={setIsSavingRecipe}
      isSavingIngredient={isSavingIngredient}
      setIsSavingIngredient={setIsSavingIngredient}
      deleteConfirmDialog={deleteConfirmDialog}
      catalogIngredients={catalogIngredients}
      catalogStatus={catalogStatus}
      refetchIngredients={refetchIngredients}
    />
  );
}
