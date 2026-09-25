import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Modal } from '../../../common/components/Modal';
import { useMediaQuery } from '../../../common/hooks/useMediaQuery';
import { IngredientForm } from '../components/IngredientForm';
import { RecipeCatalogList } from '../components/RecipeCatalogList';
import { RecipeForm } from '../components/RecipeForm';
import { useIngredients } from '../hooks/useIngredients';
import { useRecipes } from '../hooks/useRecipes';




// NUT-20 (octava iteración) — adaptación tablet/desktop (design.md sección 9.4/9.5): en
// escritorio, esta pantalla nunca se queda mostrando el listado "puro" si ya hay recetas
// cargadas — redirige de inmediato a `/recipes/{primera receta}` (layout de dos columnas de
// `RecipeDetailPage`), reemplazando la entrada de historial. En mobile, o con el listado
// vacío, sigue mostrando el listado tal cual (ahora vía `RecipeCatalogList`).
const DESKTOP_MEDIA_QUERY = '(min-width: 768px)';

// NUT-20 (ajuste visual pedido directamente por la PO, comparando la app real contra los
// mockups de Stitch de la pantalla de recetas): reemplaza el header anterior (`<h1>Recetas</h1>`
// + "Actualizar") por ícono + título "NutrIA" + subtítulo "Recetario & Catálogo", con el botón
// "+ Ingrediente" (que antes vivía como chip dentro de `RecipeCatalogList`) reubicado acá. El
// botón "Actualizar" se muda a la fila "N RECETAS DISPONIBLES" dentro de `RecipeCatalogList`.
function RecipesHeader({
  onCreateIngredient,
  onCreateRecipe,
}: {
  onCreateIngredient: () => void;
  onCreateRecipe: () => void;
}) {
  return (
    <div
      data-testid="recipes-header"
      className="sticky top-0 z-40 -mx-4 border-b border-outline-variant/30 bg-brand-cream/90 px-4 py-3 backdrop-blur-md md:hidden"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-green/10 text-brand-green">
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
              <path d="M12 22c-4.4 0-8-3.6-8-8 0-6 8-12 8-12s8 6 8 12c0 4.4-3.6 8-8 8Z" />
              <path d="M12 22V10" />
            </svg>
          </span>
          <div className="min-w-0 leading-tight">
            <h1 className="truncate font-headline text-lg font-bold text-on-surface">NutrIA</h1>
            <p className="truncate text-[11px] font-medium text-on-surface-variant">Recetario &amp; Catálogo</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onCreateIngredient}
            aria-label="+ Ingrediente"
            className="flex min-h-9 items-center gap-1 rounded-full border border-outline-variant/40 bg-surface-container px-3 py-1.5 text-xs font-bold text-on-surface transition-all hover:bg-surface-container-high active:scale-95"
          >
            <span aria-hidden="true" className="material-symbols-outlined" style={{ fontSize: '14px' }}>add_circle</span>
            + Ingrediente
          </button>
          <button
            type="button"
            onClick={onCreateRecipe}
            aria-label="Nueva Receta"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-green text-on-primary shadow-md transition-all hover:opacity-90 active:scale-95"
          >
            <span className="material-symbols-outlined text-xl">add</span>
          </button>
        </div>
      </div>
    </div>
  );
}


export function RecipesListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Reads ?q= from URL so TopBar search navigates here with the term pre-filled
  const urlSearchTerm = searchParams.get('q') ?? '';

  const { recipes, status, errorMessage, retry, refetch } = useRecipes();
  // NUT-20 (bug real reportado por la PO) — se llama una única vez a nivel de página, para que
  // el `RecipeForm` montado dentro del modal "Nueva Receta" reciba el catálogo por props y esta
  // misma página pueda refrescarlo tras crear un ingrediente nuevo desde el otro modal.
  const {
    ingredients: catalogIngredients,
    status: catalogStatus,
    refetch: refetchIngredients,
  } = useIngredients();
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const [modalKind, setModalKind] = useState<'recipe' | 'ingredient' | null>(null);
  // Hallazgo 2 (bloqueante, cuarto review): mientras el formulario correspondiente está
  // enviando, el `Modal` que lo envuelve deja de ser cerrable por overlay/Escape.
  const [isSavingRecipe, setIsSavingRecipe] = useState(false);
  const [isSavingIngredient, setIsSavingIngredient] = useState(false);

  // Hallazgo 2 (alto, novena iteración): mientras el formulario de "Nueva Receta" está abierto,
  // un resize/rotación que cambie `isDesktop` no debe disparar (ni dejar de disparar) la
  // redirección de escritorio a mitad de edición — se "congela" el `isDesktop` vigente al momento
  // de abrir el formulario, y se vuelve a seguir el valor en vivo recién cuando se cierra.
  const formOpen = modalKind === 'recipe';
  const [frozenIsDesktop, setFrozenIsDesktop] = useState<boolean | null>(null);
  if (formOpen && frozenIsDesktop === null) {
    setFrozenIsDesktop(isDesktop);
  } else if (!formOpen && frozenIsDesktop !== null) {
    setFrozenIsDesktop(null);
  }
  const effectiveIsDesktop = frozenIsDesktop ?? isDesktop;

  // Hallazgo 4 (alto, novena iteración): en el mismo render donde ya se cumple la condición de
  // redirect, se muestra el skeleton de carga en vez del listado completo, para que las
  // tarjetas/buscador/FAB no lleguen a pintarse ni por un frame antes de que `navigate()` surta
  // efecto.
  const shouldRedirectToDesktopDetail =
    effectiveIsDesktop && status === 'success' && recipes.length > 0;

  // Bug 4 (NUT-20, confirmado por revisión de código) — design.md 9.4/9.5 (líneas 303/343/353):
  // si el catálogo está REALMENTE vacío (`status === 'empty'`, nada a dónde redirigir), `/recipes`
  // en escritorio arma igual el layout de dos columnas (columna izquierda `RecipeCatalogList` +
  // panel derecho), en vez de colapsar a la pantalla de una sola columna compartida con mobile.
  const showDesktopEmptyLayout = effectiveIsDesktop && status === 'empty';

  useEffect(() => {
    if (!shouldRedirectToDesktopDetail) {
      return;
    }
    // Hallazgo 4 (alto, novena iteración): la navegación se difiere fuera del flush síncrono de
    // este mismo efecto (React/testing-library aplican `useEffect` de forma síncrona dentro de
    // `render()`), para dar lugar a que el render de este mismo tick — con el skeleton en vez
    // del listado completo, ver más abajo — llegue a pintarse antes de que `navigate()` surta
    // efecto, evitando el salto de layout.
    const targetId = recipes[0].id;
    const timeoutId = setTimeout(() => {
      navigate(`/recipes/${targetId}`, { replace: true });
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [shouldRedirectToDesktopDetail, recipes, navigate]);

  const modals = (
    <>
      <Modal
        open={modalKind === 'recipe'}
        onClose={() => setModalKind(null)}
        title="Nueva Receta"
        dismissible={!isSavingRecipe}
      >
        <RecipeForm
          mode="create"
          catalogIngredients={catalogIngredients}
          catalogStatus={catalogStatus}
          onSuccess={() => {
            setModalKind(null);
            refetch();
          }}
          onCancel={() => setModalKind(null)}
          onSubmittingChange={setIsSavingRecipe}
        />
      </Modal>

      <Modal
        open={modalKind === 'ingredient'}
        onClose={() => setModalKind(null)}
        title="Nuevo Ingrediente"
        dismissible={!isSavingIngredient}
      >
        <IngredientForm
          onSuccess={() => {
            setModalKind(null);
            refetchIngredients();
          }}
          onCancel={() => setModalKind(null)}
          onSubmittingChange={setIsSavingIngredient}
        />
      </Modal>
    </>
  );

  // Bug 4 (NUT-20): escritorio + catálogo realmente vacío — layout de dos columnas (design.md
  // 9.4/9.5), no la pantalla de una sola columna compartida con mobile. Columna izquierda:
  // `RecipeCatalogList` montado (que ya muestra su propio estado vacío). Panel derecho: estado
  // vacío equivalente, inline (no exportado desde `RecipeCatalogList`), conectado a la misma
  // acción de crear receta.
  if (showDesktopEmptyLayout) {
    return (
      <>
        <div aria-hidden={modalKind !== null} className="mx-auto flex max-w-6xl gap-6 px-4 py-6 md:px-8">
          <div className="w-full max-w-sm shrink-0 space-y-4">
            <RecipesHeader
              onCreateIngredient={() => setModalKind('ingredient')}
              onCreateRecipe={() => setModalKind('recipe')}
            />

            <RecipeCatalogList
              recipes={recipes}
              status={status}
              errorMessage={errorMessage}
              onRetry={retry}
              onRefresh={refetch}
              onSelectRecipe={(id) => navigate(`/recipes/${id}`)}
              onCreateRecipe={() => setModalKind('recipe')}
              searchTerm={urlSearchTerm}
              onSearchTermChange={(q) => setSearchParams(q ? { q } : {})}
            />
          </div>

          <div className="flex-1 space-y-4">
            <div className="mx-auto max-w-3xl rounded-2xl border border-outline-variant/30 bg-white px-6 py-12 text-center md:px-8 shadow-sm">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-container">
                <span className="material-symbols-outlined text-3xl text-on-surface-variant" aria-hidden="true">dinner_dining</span>
              </div>
              <p className="font-headline text-lg font-bold text-on-surface">
                Todavía no tenés recetas
              </p>
              <p className="mt-2 text-sm text-on-surface-variant">
                Creá tu primera receta para empezar a armar tu recetario.
              </p>
              <button
                type="button"
                onClick={() => setModalKind('recipe')}
                className="mt-5 min-h-[44px] rounded-xl bg-brand-green px-6 text-sm font-semibold text-on-primary transition-all hover:bg-brand-green-dark active:scale-95"
              >
                Crear receta
              </button>
            </div>
          </div>
        </div>

        {modals}
      </>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-3 px-4 pb-6 pt-4 md:px-8">
      {/* Ocultada del árbol de accesibilidad mientras hay un modal abierto: evita colisiones
          de query (p. ej. el chip de filtro "VEGAN" de esta lista vs. el chip de categoría
          "VEGAN" del `RecipeForm` dentro del modal) y sigue el patrón estándar de diálogos
          modales de no exponer el contenido de fondo a lectores de pantalla. */}
      <div aria-hidden={modalKind !== null} className="space-y-3">
        <RecipesHeader
          onCreateIngredient={() => setModalKind('ingredient')}
          onCreateRecipe={() => setModalKind('recipe')}
        />

        <RecipeCatalogList
          recipes={recipes}
          status={shouldRedirectToDesktopDetail ? 'loading' : status}
          errorMessage={errorMessage}
          onRetry={retry}
          onRefresh={refetch}
          onSelectRecipe={(id) => navigate(`/recipes/${id}`)}
          onCreateRecipe={() => setModalKind('recipe')}
          searchTerm={urlSearchTerm}
          onSearchTermChange={(q) => setSearchParams(q ? { q } : {})}
        />
      </div>

      {modals}
    </main>
  );
}
