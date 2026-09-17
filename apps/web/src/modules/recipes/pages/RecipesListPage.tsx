import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

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

export function RecipesListPage() {
  const navigate = useNavigate();
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
            <div className="flex items-center justify-between">
              <h1 className="font-serif text-2xl font-bold text-neutral-900">Recetas</h1>
              <button
                type="button"
                onClick={refetch}
                className="min-h-[44px] rounded-lg bg-brand-cream-dark px-4 text-sm font-semibold text-neutral-700"
              >
                Actualizar
              </button>
            </div>

            <RecipeCatalogList
              recipes={recipes}
              status={status}
              errorMessage={errorMessage}
              onRetry={retry}
              onSelectRecipe={(id) => navigate(`/recipes/${id}`)}
              onCreateRecipe={() => setModalKind('recipe')}
              onCreateIngredient={() => setModalKind('ingredient')}
            />
          </div>

          <div className="flex-1 space-y-4">
            <div className="mx-auto max-w-3xl px-4 py-10 text-center md:px-8">
              <p className="font-serif text-lg font-semibold text-neutral-900">
                Todavía no tenés recetas
              </p>
              <p className="mt-2 text-sm text-neutral-500">
                Creá tu primera receta para empezar a armar tu recetario.
              </p>
              <button
                type="button"
                onClick={() => setModalKind('recipe')}
                className="mt-4 min-h-[44px] rounded-lg bg-brand-green px-6 text-sm font-semibold text-white"
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
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:px-8">
      {/* Ocultada del árbol de accesibilidad mientras hay un modal abierto: evita colisiones
          de query (p. ej. el chip de filtro "VEGAN" de esta lista vs. el chip de categoría
          "VEGAN" del `RecipeForm` dentro del modal) y sigue el patrón estándar de diálogos
          modales de no exponer el contenido de fondo a lectores de pantalla. */}
      <div aria-hidden={modalKind !== null} className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-2xl font-bold text-neutral-900">Recetas</h1>
          <button
            type="button"
            onClick={refetch}
            className="min-h-[44px] rounded-lg bg-brand-cream-dark px-4 text-sm font-semibold text-neutral-700"
          >
            Actualizar
          </button>
        </div>

        <RecipeCatalogList
          recipes={recipes}
          status={shouldRedirectToDesktopDetail ? 'loading' : status}
          errorMessage={errorMessage}
          onRetry={retry}
          onSelectRecipe={(id) => navigate(`/recipes/${id}`)}
          onCreateRecipe={() => setModalKind('recipe')}
          onCreateIngredient={() => setModalKind('ingredient')}
        />
      </div>

      {modals}
    </main>
  );
}
