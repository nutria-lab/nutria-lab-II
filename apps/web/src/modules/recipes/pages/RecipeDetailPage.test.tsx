import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecipeDetailPage } from './RecipeDetailPage';
import { useRecipeDetail } from '../hooks/useRecipeDetail';
import { useRecipes } from '../hooks/useRecipes';
import { useIngredients } from '../hooks/useIngredients';
import { useMediaQuery } from '../../../common/hooks/useMediaQuery';
import { recipeService, RecipeRequestError, type Recipe } from '../../../services/recipeService';
import { ingredientService, type Ingredient } from '../../../services/ingredientService';

// NUT-20 (quinta iteración, tester) — `RecipeDetailPage` todavía NO EXISTE (ver design.md
// secciones "Detalle de Receta"/4.1/4.2, y `useRecipeDetail`, ya construido en una iteración
// anterior de este mismo ticket, que hoy no lo consume ninguna pantalla real). Reemplaza, en
// el wiring real de `App.tsx`, la ruta `/recipes/:id` que hoy no existe. Se espera ROJO hoy
// por módulo inexistente.
//
// Mismo patrón de mock que el resto del módulo (`RecipesListPage.test.tsx`,
// `RecipeForm.test.tsx`): se mockea el hook de dominio completo (`useRecipeDetail`) en vez de
// reproducir cada camino async del hook real, y se deja el `RecipeForm` REAL sin mockear
// dentro del modal de edición (mockeando sólo `useIngredients`, que ese formulario consume
// para las sugerencias de catálogo, y los métodos de `recipeService` usados:
// `update` — por el `RecipeForm` real — y `remove` — usado directamente por esta página para
// el flujo de borrado).
//
// --- Criterios propios del tester (documentados también en el informe final) ---------------
// - Nombres accesibles exactos: ✕ del header → aria-label "Cerrar" (mismo nombre que usa
//   `Modal.tsx`; sin ambigüedad en estos tests porque nunca se consulta ese nombre mientras un
//   modal/diálogo está abierto al mismo tiempo — esos casos usan `within(dialog)`); ícono
//   lápiz → aria-label "Editar"; ícono tacho → aria-label "Eliminar"; título de cabecera → un
//   `<h1>` con texto exacto "Detalle de Receta"; botón inferior → texto "Cerrar Detalle".
// - Stats: tiempo total con el mismo formato ya usado por `RecipesListPage`
//   ("{prepMinutes + cookMinutes} min"); si `nutritionalValues` no es `null`, se agregan
//   "{calories} kcal", "{protein} g" y "{carbs} g" — formato propio del tester, design.md no
//   fija el string exacto para esta pantalla.
// - Ingredientes: cada fila como "{quantity} {unit} de {name}".
// - "Volver al listado" en el estado "no encontrada" se implementa como un `<Link>` real de
//   react-router (rol "link"), no como botón con `navigate()` programático.
// - Confirmación de borrado: se apoya en el `ConfirmDialog` genérico nuevo de este mismo PR
//   (`common/components/ConfirmDialog.tsx`), que no tiene una prop de error propia (ver su
//   propio test) — el mensaje de error de borrado se logra pasando un `message` distinto
//   mientras `open` se mantiene `true`.
// - Refresco tras editar: se verifica invocando `retry()` del hook de detalle mockeado (no se
//   intenta reproducir un segundo valor de retorno disparado por un re-render real) — la
//   propia consigna habilita explícitamente este criterio como el más determinístico.

vi.mock('../hooks/useRecipeDetail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useRecipeDetail')>();
  return {
    ...actual,
    useRecipeDetail: vi.fn(),
  };
});

// NUT-20 (octava iteración, tester) — adaptación tablet/desktop (design.md sección 9.5): en
// escritorio, `RecipeDetailPage` monta el layout de dos columnas completo, lo que implica que
// TAMBIÉN llama a `useRecipes()` (mismo hook, misma petición que ya usa `RecipesListPage`) para
// poblar la columna izquierda (`RecipeCatalogList`) — sin volver a pedir el detalle por
// separado. Se mockea igual que en `RecipesListPage.test.tsx`.
vi.mock('../hooks/useRecipes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useRecipes')>();
  return {
    ...actual,
    useRecipes: vi.fn(),
  };
});

// `useMediaQuery` todavía NO EXISTE (ver `useMediaQuery.test.ts`). Se mockea el hook completo
// para forzar "escritorio"/"mobile" de forma determinística. Default `false` (mobile) en el
// `beforeEach` de abajo: todos los tests ya existentes de este archivo, que no mencionan este
// hook, deben seguir viendo exactamente el comportamiento mobile ya validado, sin cambios.
vi.mock('../../../common/hooks/useMediaQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../common/hooks/useMediaQuery')>();
  return {
    ...actual,
    useMediaQuery: vi.fn(),
  };
});

vi.mock('../hooks/useIngredients', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useIngredients')>();
  return {
    ...actual,
    useIngredients: vi.fn(),
  };
});

vi.mock('../../../services/recipeService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/recipeService')>();
  return {
    ...actual,
    recipeService: {
      ...actual.recipeService,
      update: vi.fn(),
      remove: vi.fn(),
    },
  };
});

// NUT-20 (tester, bug real reportado en vivo por la PO) — necesario para el nuevo describe de
// más abajo ("ingrediente nuevo visible sin cerrar el panel de receta"): ese test crea un
// ingrediente real desde el modal "Nuevo Ingrediente" (`IngredientForm`, sin mockear), así que
// hay que mockear el servicio HTTP que ese formulario real termina llamando — mismo patrón
// `importOriginal` + override de `create` ya usado en `RecipesListPage.test.tsx`.
vi.mock('../../../services/ingredientService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/ingredientService')>();
  return {
    ...actual,
    ingredientService: {
      ...actual.ingredientService,
      create: vi.fn(),
    },
  };
});

const HEADER_CLOSE_LABEL = 'Cerrar';
const EDIT_LABEL = 'Editar';
const DELETE_LABEL = 'Eliminar';
const CLOSE_DETAIL_LABEL = 'Cerrar Detalle';
const DETAIL_TITLE = 'Detalle de Receta';
const NOT_FOUND_MESSAGE = /ya no está disponible/i;
const BACK_TO_LIST_LABEL = 'Volver al listado';
const GENERIC_ERROR_MESSAGE = 'No pudimos cargar esta receta. Intentá de nuevo.';
const RETRY_LABEL = 'Reintentar';
const DELETE_CONFIRM_MESSAGE_PATTERN = /seguro.*eliminar/i;
const DELETE_CONFLICT_ERROR =
  'No pudimos eliminar la receta: puede que ya no exista o haya cambiado. Volvé a intentarlo.';

function buildRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'recipe-1',
    title: 'Ensalada Vegana Detox',
    description: 'Una ensalada fresca con vegetales de estación y limón.',
    categories: ['VEGAN', 'GLUTEN_FREE'],
    prepMinutes: 10,
    cookMinutes: 15,
    ingredients: [
      { name: 'Lechuga', quantity: 1, unit: 'unidad' },
      { name: 'Tomate', quantity: 2, unit: 'kg' },
    ],
    instructions: ['Lavar y cortar los vegetales.', 'Mezclar con aderezo.'],
    nutritionalValues: { calories: 180, protein: 6, carbs: 20, fat: 8 },
    properties: ['Vegano', 'Sin Gluten'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockDetail(overrides: Partial<ReturnType<typeof useRecipeDetail>> = {}) {
  vi.mocked(useRecipeDetail).mockReturnValue({
    recipe: null,
    status: 'success',
    errorMessage: null,
    retry: vi.fn(),
    ...overrides,
  });
}

function mockIngredientsForForm() {
  vi.mocked(useIngredients).mockReturnValue({
    ingredients: [],
    status: 'empty',
    errorMessage: null,
    retry: vi.fn(),
    refetch: vi.fn(),
  });
}

// NUT-20 (octava iteración, tester): alimenta la columna izquierda (`RecipeCatalogList`) del
// layout de escritorio. Default vacío/success: los tests mobile ya existentes no leen este
// hook para nada, así que el valor por defecto es irrelevante para ellos.
function mockRecipesForCatalog(overrides: Partial<ReturnType<typeof useRecipes>> = {}) {
  vi.mocked(useRecipes).mockReturnValue({
    recipes: [],
    status: 'success',
    errorMessage: null,
    retry: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderDetailPage(id = 'recipe-1') {
  return render(
    <MemoryRouter initialEntries={[`/recipes/${id}`]}>
      <Routes>
        <Route path="/recipes/:id" element={<RecipeDetailPage />} />
        <Route path="/recipes" element={<p>Listado</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

beforeEach(() => {
  // Default "mobile" (viewport angosto) — no-regresión explícita para todos los tests que ya
  // existían antes de esta iteración y no mencionan `useMediaQuery`/`useRecipes`.
  vi.mocked(useMediaQuery).mockReturnValue(false);
  mockRecipesForCatalog();
});

describe('RecipeDetailPage — cargando', () => {
  it('shows a skeleton (aria-busy) and no recipe content while status is "loading"', () => {
    mockDetail({ recipe: null, status: 'loading' });
    mockIngredientsForForm();

    renderDetailPage();

    expect(screen.getByTestId('recipe-detail-skeleton')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('heading', { name: DETAIL_TITLE })).not.toBeInTheDocument();
  });
});

describe('RecipeDetailPage — no encontrada', () => {
  it('shows a message distinct from the generic error, with a link back to the recipe list', async () => {
    mockDetail({ recipe: null, status: 'notFound' });
    mockIngredientsForForm();
    const user = userEvent.setup();

    renderDetailPage();

    expect(screen.getByText(NOT_FOUND_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(GENERIC_ERROR_MESSAGE)).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: BACK_TO_LIST_LABEL }));

    expect(await screen.findByText('Listado')).toBeInTheDocument();
  });
});

describe('RecipeDetailPage — error genérico', () => {
  it('shows an error message with a "Reintentar" button that calls retry', async () => {
    const retry = vi.fn();
    mockDetail({ recipe: null, status: 'error', errorMessage: GENERIC_ERROR_MESSAGE, retry });
    mockIngredientsForForm();
    const user = userEvent.setup();

    renderDetailPage();

    expect(screen.getByText(GENERIC_ERROR_MESSAGE)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: RETRY_LABEL }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('RecipeDetailPage — éxito, contenido completo', () => {
  it('renders every section with the fixture data', () => {
    const recipe = buildRecipe();
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();

    renderDetailPage();

    expect(screen.getByRole('heading', { name: DETAIL_TITLE })).toBeInTheDocument();
    expect(screen.getAllByText(recipe.title).length).toBeGreaterThan(0);

    // Badge de categoría (la primera) superpuesto al skeleton/placeholder estático de imagen.
    // NUT-20 (décima iteración, tester) — corrección de UX pedida directamente por la PO: el
    // badge muestra la etiqueta traducida (`RECIPE_CATEGORY_LABELS` de `labels.ts`), nunca el
    // valor RAW del enum en inglés/mayúsculas (`recipe.categories[0]` es `'VEGAN'`, la etiqueta
    // esperada es "Vegano"). La fixture además tiene `properties: ['Vegano', ...]` (dato de
    // dominio no relacionado al enum, ver sección "Propiedades y Restricciones" más abajo en
    // este mismo test), así que "Vegano" aparece dos veces en la página — la query se escopa al
    // placeholder de imagen (sin testid en producción: se ubica por posición/rol, tal como el
    // propio `RecipeImagePlaceholder` lo renderiza — el `<h2>` del título de la receta es
    // siempre su hermano inmediato siguiente) para no ser ambigua frente a esa otra aparición.
    const recipeTitleHeading = screen.getByRole('heading', { name: recipe.title });
    const imagePlaceholder = recipeTitleHeading.previousElementSibling as HTMLElement;
    expect(within(imagePlaceholder).getByText('Vegano')).toBeInTheDocument();
    expect(within(imagePlaceholder).queryByText(recipe.categories[0])).not.toBeInTheDocument();

    // Stats: tiempo total (prepMinutes + cookMinutes) + valores nutricionales, no nulos acá.
    expect(screen.getByText('25 min')).toBeInTheDocument();
    expect(screen.getByText('180 kcal')).toBeInTheDocument();
    expect(screen.getByText(/6 g/)).toBeInTheDocument();
    expect(screen.getByText(/20 g/)).toBeInTheDocument();

    // Descripción.
    expect(screen.getByRole('heading', { name: 'Descripción' })).toBeInTheDocument();
    expect(screen.getByText(recipe.description)).toBeInTheDocument();

    // Ingredientes (N).
    expect(
      screen.getByRole('heading', { name: `Ingredientes (${recipe.ingredients.length})` }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 unidad de Lechuga')).toBeInTheDocument();
    expect(screen.getByText('2 kg de Tomate')).toBeInTheDocument();

    // Pasos de Preparación, numerados.
    expect(screen.getByRole('heading', { name: 'Pasos de Preparación' })).toBeInTheDocument();
    expect(screen.getByText('Lavar y cortar los vegetales.')).toBeInTheDocument();
    expect(screen.getByText('Mezclar con aderezo.')).toBeInTheDocument();

    // Propiedades y Restricciones. NUT-20 (décima iteración, tester): escopada al `<section>`
    // de esta propia lista (localizado por su heading, sin depender de clases CSS) porque el
    // badge de categoría traducido, de arriba, ahora también dice literalmente "Vegano" —
    // mismo motivo por el que la aserción del badge se escopó al placeholder de imagen.
    const propertiesHeading = screen.getByRole('heading', { name: 'Propiedades y Restricciones' });
    expect(propertiesHeading).toBeInTheDocument();
    const propertiesSection = propertiesHeading.closest('section') as HTMLElement;
    expect(within(propertiesSection).getByText('Vegano')).toBeInTheDocument();
    expect(within(propertiesSection).getByText('Sin Gluten')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: CLOSE_DETAIL_LABEL })).toBeInTheDocument();
  });
});

describe('RecipeDetailPage — éxito con nutritionalValues: null', () => {
  it('does not show calories/protein/carbs for that recipe, without breaking or inventing values', () => {
    const recipe = buildRecipe({ nutritionalValues: null });
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();

    renderDetailPage();

    expect(screen.getByText('25 min')).toBeInTheDocument();
    expect(screen.queryByText(/kcal/)).not.toBeInTheDocument();
  });
});

describe('RecipeDetailPage — cerrar', () => {
  it('navigates back to /recipes when the header ✕ is clicked', async () => {
    const recipe = buildRecipe();
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();
    const user = userEvent.setup();

    renderDetailPage();

    await user.click(screen.getByRole('button', { name: HEADER_CLOSE_LABEL }));

    expect(await screen.findByText('Listado')).toBeInTheDocument();
  });

  it('navigates back to /recipes when the "Cerrar Detalle" button is clicked', async () => {
    const recipe = buildRecipe();
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();
    const user = userEvent.setup();

    renderDetailPage();

    await user.click(screen.getByRole('button', { name: CLOSE_DETAIL_LABEL }));

    expect(await screen.findByText('Listado')).toBeInTheDocument();
  });
});

describe('RecipeDetailPage — editar', () => {
  it('opens the edit modal with a precargado RecipeForm, and refreshes the detail after a successful edit', async () => {
    const recipe = buildRecipe();
    const retry = vi.fn();
    mockDetail({ recipe, status: 'success', retry });
    mockIngredientsForForm();
    vi.mocked(recipeService.update).mockResolvedValue(buildRecipe({ title: 'Ensalada Actualizada' }));
    const user = userEvent.setup();

    renderDetailPage();

    await user.click(screen.getByRole('button', { name: EDIT_LABEL }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Modificar Receta')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Nombre de la Receta/i)).toHaveValue(recipe.title);
    expect(within(dialog).getByRole('button', { name: 'Guardar Cambios' })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Guardar Cambios' }));

    await waitFor(() => expect(recipeService.update).toHaveBeenCalledTimes(1));
    expect(recipeService.update).toHaveBeenCalledWith(recipe.id, expect.any(Object));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('RecipeDetailPage — borrar, flujo completo', () => {
  it('opens ConfirmDialog on the trash icon; Cancelar closes it without calling remove or navigating', async () => {
    const recipe = buildRecipe();
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();
    const user = userEvent.setup();

    renderDetailPage();

    await user.click(screen.getByRole('button', { name: DELETE_LABEL }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(DELETE_CONFIRM_MESSAGE_PATTERN)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(recipeService.remove).not.toHaveBeenCalled();
    expect(screen.queryByText('Listado')).not.toBeInTheDocument();
  });

  it('Eliminar calls recipeService.remove(id) and navigates to /recipes on success', async () => {
    const recipe = buildRecipe();
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();
    vi.mocked(recipeService.remove).mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderDetailPage();

    await user.click(screen.getByRole('button', { name: DELETE_LABEL }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Eliminar' }));

    await waitFor(() => expect(recipeService.remove).toHaveBeenCalledWith(recipe.id));
    expect(await screen.findByText('Listado')).toBeInTheDocument();
  });
});

describe('RecipeDetailPage — borrar, error', () => {
  it('keeps ConfirmDialog open showing the error message and does not navigate when remove rejects', async () => {
    const recipe = buildRecipe();
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();
    vi.mocked(recipeService.remove).mockRejectedValue(new RecipeRequestError('conflict'));
    const user = userEvent.setup();

    renderDetailPage();

    await user.click(screen.getByRole('button', { name: DELETE_LABEL }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Eliminar' }));

    expect(await within(dialog).findByText(DELETE_CONFLICT_ERROR)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('Listado')).not.toBeInTheDocument();
  });
});

// NUT-20 (séptima iteración, tester) — Hallazgo 1 (bloqueante) del cuarto review: el backend
// real de hoy (pre-NUT-61) puede devolver una receta SIN `categories`/`nutritionalValues`/
// `properties` (`undefined`, campo directamente ausente). Hoy `recipe.categories[0]` y
// `recipe.properties.map(...)` asumen que esos campos siempre existen y rompen con un
// `TypeError` ante este fixture. Se espera ROJO.
describe('RecipeDetailPage — backend real pre-NUT-61 sin categories/nutritionalValues/properties (Hallazgo 1, cuarto review)', () => {
  it('renders without throwing, without an "undefined" string on screen, and without a broken properties section', () => {
    const legacyRecipe = {
      ...buildRecipe(),
      categories: undefined,
      nutritionalValues: undefined,
      properties: undefined,
    } as never as Recipe;
    mockDetail({ recipe: legacyRecipe, status: 'success' });
    mockIngredientsForForm();

    expect(() => renderDetailPage()).not.toThrow();

    expect(screen.getAllByText(legacyRecipe.title).length).toBeGreaterThan(0);
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
    expect(screen.queryByText(/kcal/)).not.toBeInTheDocument();
    // Ingredientes/instrucciones sí vienen en el fixture (no son parte de este hallazgo): la
    // pantalla debe seguir mostrándolos con normalidad, sólo la sección de
    // propiedades/categoría/nutrición debe degradar con gracia.
    expect(screen.getByText('1 unidad de Lechuga')).toBeInTheDocument();
  });
});

// NUT-20 (séptima iteración, tester) — Hallazgo 2 (bloqueante) del cuarto review: mientras el
// `RecipeForm` del modal de edición está enviando, hoy el `Modal` sigue siendo cerrable por
// `Escape` sin ninguna restricción. La corrección: la página debe pasar
// `dismissible={!isSubmittingRecipe}` al `Modal` de edición, usando el nuevo callback
// `onSubmittingChange` de `RecipeForm`. Se espera ROJO hoy.
describe('RecipeDetailPage — Modal de edición no dismissible mientras el guardado está pendiente (Hallazgo 2, cuarto review)', () => {
  it('the edit modal does not close via Escape while the recipe update is still pending', async () => {
    const recipe = buildRecipe();
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();
    const { promise } = createDeferred<Recipe>();
    vi.mocked(recipeService.update).mockReturnValue(promise);
    const user = userEvent.setup();

    renderDetailPage();

    await user.click(screen.getByRole('button', { name: EDIT_LABEL }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar Cambios' }));

    // La promesa de `recipeService.update` sigue sin resolver: el guardado está en curso.
    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

// NUT-20 (séptima iteración, tester) — Hallazgo 3 (alto) del cuarto review: `useRecipeDetail`
// hoy borra el `recipe` ante CUALQUIER error, así que esta página nunca llega a mostrar el
// contenido junto con un error si ya había datos cargados. Tras la corrección del hook (ver
// `useRecipeDetail.test.ts`), esta página debe mostrar el contenido de la receta CON un banner
// de error superpuesto (mismo patrón que `RecipesListPage` con `Banner` cuando
// `status === 'error' && recipes.length > 0`), no la pantalla completa de "Algo salió mal",
// cuando el hook expone `status: 'error'` con un `recipe` no nulo. Se espera ROJO: hoy
// `status === 'error'` siempre muestra la pantalla completa, sin mirar si `recipe` ya tiene
// datos.
describe('RecipeDetailPage — status "error" con recipe ya cargado (Hallazgo 3, cuarto review)', () => {
  it('keeps showing the recipe content together with an error banner, instead of the full-screen generic error', () => {
    const recipe = buildRecipe();
    mockDetail({ recipe, status: 'error', errorMessage: 'No pudimos actualizar. Intentá de nuevo.' });
    mockIngredientsForForm();

    renderDetailPage();

    expect(screen.getByRole('heading', { name: DETAIL_TITLE })).toBeInTheDocument();
    expect(screen.getAllByText(recipe.title).length).toBeGreaterThan(0);
    expect(screen.getByText('No pudimos actualizar. Intentá de nuevo.')).toBeInTheDocument();
    expect(screen.queryByText('Algo salió mal')).not.toBeInTheDocument();
  });
});

// NUT-20 (séptima iteración, tester) — Hallazgo 4 (alto) del cuarto review: `handleDelete` no
// tiene un `if (deleting) return;` al principio (a diferencia de `RecipeForm`/`IngredientForm`,
// que sí lo tienen en su `handleSubmit`). Un doble-click real MUY rápido, o mantener Enter
// presionado, puede entregar ambos eventos de click antes de que React llegue a comprometer en
// el DOM el `disabled` que `ConfirmDialog` ya aplica durante `isConfirming` — el propio
// `disabled` del botón no alcanza a proteger esa ventana de carrera. Para reproducirlo de forma
// determinística (sin depender de timings reales de un doble-click de navegador), ambos
// `fireEvent.click` se disparan dentro de un mismo `act(...)` síncrono: React sólo aplica
// (flushea) las actualizaciones de estado pendientes al SALIR de ese bloque, así que las dos
// llamadas a `handleDelete` ocurren antes de que el `disabled` llegue a reflejarse en el nodo
// real — exactamente la ventana de carrera que el hallazgo describe. Se espera ROJO hoy:
// `recipeService.remove` se llama dos veces.
describe('RecipeDetailPage — borrar, reentrancia (Hallazgo 4, cuarto review)', () => {
  it('a rapid double click on "Eliminar" (both dispatched before React can disable the button) calls recipeService.remove only once', async () => {
    const recipe = buildRecipe();
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();
    const { promise, resolve } = createDeferred<void>();
    vi.mocked(recipeService.remove).mockReturnValue(promise);
    const user = userEvent.setup();

    renderDetailPage();

    await user.click(screen.getByRole('button', { name: DELETE_LABEL }));
    const dialog = await screen.findByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'Eliminar' });

    act(() => {
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);
    });

    expect(recipeService.remove).toHaveBeenCalledTimes(1);

    resolve(undefined);
    await waitFor(() => expect(screen.queryByText('Listado')).toBeInTheDocument());
  });
});

// NUT-20 (octava iteración, tester) — adaptación tablet/desktop (design.md sección 9.2/9.3/9.5).
// En escritorio, `RecipeDetailPage` renderiza un layout de DOS COLUMNAS: izquierda =
// `RecipeCatalogList` (mismo listado/buscador/chips, alimentado por `useRecipes`, siempre
// visible), derecha = panel dinámico (detalle actual | `RecipeForm` crear inline | `RecipeForm`
// editar inline — nunca envuelto en `Modal` en esta variante). `IngredientForm` sigue siendo
// SIEMPRE modal, disparado desde el "+ Ingrediente" que ya trae `RecipeCatalogList` (mismo pill
// ya usado en mobile). Se espera ROJO hoy: `RecipeDetailPage` todavía no tiene ninguna rama de
// escritorio (todo lo de abajo requiere `useMediaQuery` — módulo inexistente — y
// `RecipeCatalogList` — componente inexistente).
describe('RecipeDetailPage — escritorio, layout de dos columnas (design.md 9.2/9.3)', () => {
  it('shows the recipe catalog list on the left alongside the current recipe detail on the right, at the same time', () => {
    const recipe = buildRecipe();
    const other = buildRecipe({ id: 'recipe-2', title: 'Otra Receta' });
    vi.mocked(useMediaQuery).mockReturnValue(true);
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();
    mockRecipesForCatalog({ recipes: [recipe, other], status: 'success' });

    renderDetailPage(recipe.id);

    // Columna izquierda: buscador + ambas tarjetas.
    expect(screen.getByRole('textbox', { name: /buscar/i })).toBeInTheDocument();
    expect(screen.getByTestId(`recipe-card-${recipe.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`recipe-card-${other.id}`)).toBeInTheDocument();

    // Columna derecha: detalle de la receta actual, visible AL MISMO TIEMPO.
    expect(screen.getByRole('heading', { name: DETAIL_TITLE })).toBeInTheDocument();
    expect(screen.getAllByText(recipe.title).length).toBeGreaterThan(0);
  });

  it('clicking "Nueva Receta" shows RecipeForm inline (create mode) in the right panel, without any dialog, and keeps the left list visible', async () => {
    const recipe = buildRecipe();
    vi.mocked(useMediaQuery).mockReturnValue(true);
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();
    mockRecipesForCatalog({ recipes: [recipe], status: 'success' });
    const user = userEvent.setup();

    renderDetailPage(recipe.id);

    await user.click(screen.getByRole('button', { name: 'Nueva Receta' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Nombre de la Receta/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar Receta' })).toBeInTheDocument();
    // El listado de la izquierda sigue montado mientras el panel derecho muestra el formulario.
    expect(screen.getByTestId(`recipe-card-${recipe.id}`)).toBeInTheDocument();
  });

  it('clicking "Modificar Receta" shows RecipeForm inline (edit mode) in the right panel, precargado, without any dialog', async () => {
    const recipe = buildRecipe();
    vi.mocked(useMediaQuery).mockReturnValue(true);
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();
    mockRecipesForCatalog({ recipes: [recipe], status: 'success' });
    const user = userEvent.setup();

    renderDetailPage(recipe.id);

    await user.click(screen.getByRole('button', { name: 'Modificar Receta' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Nombre de la Receta/i)).toHaveValue(recipe.title);
    expect(screen.getByRole('button', { name: 'Guardar Cambios' })).toBeInTheDocument();
  });

  it('clicking "+ Ingrediente" opens IngredientForm in a dialog, without unmounting an in-progress inline RecipeForm behind it', async () => {
    const recipe = buildRecipe();
    vi.mocked(useMediaQuery).mockReturnValue(true);
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();
    mockRecipesForCatalog({ recipes: [recipe], status: 'success' });
    const user = userEvent.setup();

    renderDetailPage(recipe.id);

    await user.click(screen.getByRole('button', { name: 'Nueva Receta' }));
    const titleInput = screen.getByLabelText(/^Nombre de la Receta/i);
    await user.type(titleInput, 'Receta a medio completar');

    await user.click(screen.getByRole('button', { name: '+ Ingrediente' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/^Nombre/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // El `RecipeForm` de creación a medio completar sigue montado e intacto detrás del modal.
    expect(screen.getByLabelText(/^Nombre de la Receta/i)).toHaveValue('Receta a medio completar');
  });

  it('selecting another recipe from the left column navigates and updates the right panel to that recipe', async () => {
    const recipe = buildRecipe();
    const other = buildRecipe({
      id: 'recipe-2',
      title: 'Otra Receta',
      description: 'Otra descripción de prueba, bien distinta.',
    });
    vi.mocked(useMediaQuery).mockReturnValue(true);
    mockIngredientsForForm();
    mockRecipesForCatalog({ recipes: [recipe, other], status: 'success' });
    vi.mocked(useRecipeDetail).mockImplementation((id: string) => ({
      recipe: id === other.id ? other : recipe,
      status: 'success',
      errorMessage: null,
      retry: vi.fn(),
    }));
    const user = userEvent.setup();

    renderDetailPage(recipe.id);

    await user.click(screen.getByTestId(`recipe-card-${other.id}`));

    expect(await screen.findByText(other.description)).toBeInTheDocument();
  });
});

// NUT-20 (tester, bug real reportado en vivo por la PO) — en escritorio, `DesktopRecipeDetail`
// muestra a la vez el panel izquierdo (`RecipeCatalogList`, con el botón "+ Ingrediente") y el
// panel derecho (`RecipeForm` inline, sin `Modal`, cuando `panelMode` es 'create'/'edit'). Hoy
// `RecipeForm` pide su propio catálogo de ingredientes llamando a `useIngredients()` una sola
// vez al montarse — si el usuario crea un ingrediente nuevo desde la izquierda SIN cerrar el
// panel de receta de la derecha, ese `RecipeForm` (que sigue montado, nunca se desmonta) nunca
// se entera del ingrediente nuevo hasta recargar la página completa. El fix esperado: la
// página llama a `useIngredients()` UNA VEZ a nivel de página, le pasa `ingredients`/`status` a
// `RecipeForm` vía props (`catalogIngredients`/`catalogStatus`), y el `onSuccess` del
// `IngredientForm` del modal "Nuevo Ingrediente" también invoca el `refetch()` de ESE mismo
// hook de la página (además del `catalog.refetch()` de recetas que ya hace hoy).
//
// Este test mockea `useIngredients` con un `refetch` propio y rastreable cuyo efecto (agregar
// "Kiwi" al catálogo) sólo ocurre si algo en la producción realmente lo invoca — es agnóstico
// de qué componente exacto termina llamando al hook (hoy sólo `RecipeForm`, después del fix la
// propia página), así que sigue siendo válido tanto antes como después del fix. Se espera ROJO
// hoy: nada en el código actual llama a ese `refetch`, así que "Kiwi" nunca aparece como
// sugerencia sin recargar.
describe('RecipeDetailPage — escritorio, ingrediente nuevo visible sin cerrar el panel de receta (bug real reportado por la PO)', () => {
  function buildIngredientFixture(overrides: Partial<Ingredient> = {}): Ingredient {
    return {
      id: 'ingredient-quinoa',
      name: 'Quinoa',
      description: 'Cereal andino sin gluten',
      type: 'GRAIN',
      defaultUnit: 'g',
      nutritionalValues: { calories: 120, protein: 4, carbs: 21, fat: 2 },
      properties: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      ...overrides,
    };
  }

  // Escopado al `dialog` del modal "Nuevo Ingrediente": sin esto, `getByLabelText(/^Nombre/i)`
  // es ambiguo, porque matchea a la vez el input "Nombre" del propio `IngredientForm`, el
  // "Nombre de la Receta" del `RecipeForm` que sigue abierto detrás, y el `aria-label` "Nombre
  // del ingrediente, fila 1" de cada fila de ingrediente de ese mismo `RecipeForm`.
  async function fillMinimalValidIngredientForm(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    name: string,
  ) {
    await user.type(within(dialog).getByLabelText(/^Nombre/i), name);
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /^Tipo/i }), 'GRAIN');
    await user.type(within(dialog).getByLabelText(/Unidad de Medida Habitual/i), 'unidad');
    await user.type(within(dialog).getByLabelText(/^Calorías/i), '50');
    await user.type(within(dialog).getByLabelText(/^Proteínas/i), '1');
    await user.type(within(dialog).getByLabelText(/^Carbohidratos/i), '10');
    await user.type(within(dialog).getByLabelText(/^Grasas/i), '0');
  }

  it('creating an ingredient from the left column makes it appear as a suggestion in the still-open "Nueva Receta" panel, without reloading anything', async () => {
    const recipe = buildRecipe();
    vi.mocked(useMediaQuery).mockReturnValue(true);
    mockDetail({ recipe, status: 'success' });
    mockRecipesForCatalog({ recipes: [recipe], status: 'success' });

    const kiwi = buildIngredientFixture({ id: 'ingredient-kiwi', name: 'Kiwi' });
    let ingredientsState: { ingredients: Ingredient[]; status: 'success'; errorMessage: null } = {
      ingredients: [buildIngredientFixture()],
      status: 'success',
      errorMessage: null,
    };
    const ingredientsRefetch = vi.fn(() => {
      ingredientsState = {
        ingredients: [...ingredientsState.ingredients, kiwi],
        status: 'success',
        errorMessage: null,
      };
    });
    vi.mocked(useIngredients).mockImplementation(() => ({
      ...ingredientsState,
      retry: vi.fn(),
      refetch: ingredientsRefetch,
    }));
    vi.mocked(ingredientService.create).mockResolvedValue(kiwi);

    const user = userEvent.setup();
    renderDetailPage(recipe.id);

    await user.click(screen.getByRole('button', { name: 'Nueva Receta' }));
    expect(screen.getByLabelText(/^Nombre de la Receta/i)).toBeInTheDocument();

    // Catálogo inicial: "Kiwi" todavía no existe, no es una sugerencia.
    const initialNameInput = screen.getByTestId('ingredient-name-0');
    const listId = initialNameInput.getAttribute('list');
    const initialDatalist = document.querySelector(`datalist#${listId}`);
    const initialOptionValues = Array.from(initialDatalist!.querySelectorAll('option')).map((option) =>
      option.getAttribute('value'),
    );
    expect(initialOptionValues).not.toEqual(expect.arrayContaining(['Kiwi']));

    // Crea el ingrediente nuevo desde la columna izquierda, SIN cerrar el panel de receta.
    await user.click(screen.getByRole('button', { name: '+ Ingrediente' }));
    const dialog = await screen.findByRole('dialog');
    await fillMinimalValidIngredientForm(user, dialog, 'Kiwi');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar Ingrediente' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // El panel de "Nueva Receta" sigue abierto e intacto: nunca se desmontó ni se recargó nada.
    expect(screen.getByLabelText(/^Nombre de la Receta/i)).toBeInTheDocument();

    // El ingrediente recién creado ya aparece como sugerencia en el datalist del RecipeForm
    // que seguía montado, sin recargar la página.
    const updatedNameInput = screen.getByTestId('ingredient-name-0');
    const updatedListId = updatedNameInput.getAttribute('list');
    const updatedDatalist = document.querySelector(`datalist#${updatedListId}`);
    const updatedOptionValues = Array.from(updatedDatalist!.querySelectorAll('option')).map((option) =>
      option.getAttribute('value'),
    );
    expect(updatedOptionValues).toEqual(expect.arrayContaining(['Kiwi']));
  });
});

// NUT-20 (novena iteración, tester) — Hallazgo 3 (alto): revisión de la adaptación desktop.
// `RecipeDetailPage` hoy llama `useRecipes()` de forma incondicional al tope del componente
// (para alimentar la columna izquierda de escritorio), aunque en mobile esa columna nunca se
// renderiza y el dato nunca se usa — un fetch de catálogo completo disparado en cada entrada a
// un detalle de receta en mobile, sin ningún propósito. La corrección esperada (implementer):
// dividir el componente en subcomponentes (mobile/desktop) de forma que `useRecipes()` sólo se
// invoque dentro del subcomponente de escritorio. Se espera ROJO en el primer test (mobile) hoy;
// el segundo (control, escritorio) ya debería estar en verde sin cambios.
describe('RecipeDetailPage — useRecipes no debe invocarse en mobile (Hallazgo 3, novena iteración)', () => {
  it('never calls useRecipes when isDesktop is false (the left column is never rendered on mobile)', () => {
    const recipe = buildRecipe();
    vi.mocked(useMediaQuery).mockReturnValue(false);
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();

    renderDetailPage(recipe.id);

    expect(useRecipes).not.toHaveBeenCalled();
  });

  it('control: still calls useRecipes when isDesktop is true (the left column needs the catalog)', () => {
    const recipe = buildRecipe();
    vi.mocked(useMediaQuery).mockReturnValue(true);
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();
    mockRecipesForCatalog({ recipes: [recipe], status: 'success' });

    renderDetailPage(recipe.id);

    expect(useRecipes).toHaveBeenCalled();
  });
});

// NUT-20 (novena iteración, tester) — Hallazgo 2 (alto): revisión de la adaptación desktop.
// Hoy mobile usa `modalKind` y escritorio usa `panelMode`, sin sincronizarse entre sí: si
// `isDesktop` cambia (resize/rotación) MIENTRAS hay un formulario de receta abierto, el árbol
// JSX completo cambia de rama (`if (!isDesktop) return (...)` vs. el layout de dos columnas) y
// el formulario desaparece sin avisar — ninguna de las dos ramas mira el estado de la otra. La
// corrección esperada (implementer): "congelar" qué rama se renderiza mientras haya un
// formulario de receta abierto (creando o editando), ignorando cambios de `isDesktop` hasta que
// el formulario se cierre/guarde/cancele. Se simula un resize en caliente cambiando el valor de
// retorno del `useMediaQuery` ya mockeado y forzando un re-render del mismo árbol con
// `rerender(...)` (mismo criterio ya usado en `LoginPage.test.tsx` para simular un cambio de
// prop/mock en un componente ya montado). Se espera ROJO en el primer test hoy: al pasar a
// mobile, el componente entero cambia a la rama mobile, que sólo mira `modalKind` (no
// `panelMode`), así que el formulario de edición desaparece y se ve el detalle de sólo lectura.
describe('RecipeDetailPage — freeze de layout mientras el formulario de edición está abierto (Hallazgo 2, novena iteración)', () => {
  it('keeps showing the inline edit RecipeForm after isDesktop flips to false mid-edit, instead of losing it', async () => {
    const recipe = buildRecipe();
    vi.mocked(useMediaQuery).mockReturnValue(true);
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();
    mockRecipesForCatalog({ recipes: [recipe], status: 'success' });
    const user = userEvent.setup();

    const { rerender } = renderDetailPage(recipe.id);

    await user.click(screen.getByRole('button', { name: 'Modificar Receta' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Nombre de la Receta/i)).toHaveValue(recipe.title);

    // Simula un resize a mobile MIENTRAS el formulario de edición sigue abierto.
    vi.mocked(useMediaQuery).mockReturnValue(false);
    rerender(
      <MemoryRouter initialEntries={[`/recipes/${recipe.id}`]}>
        <Routes>
          <Route path="/recipes/:id" element={<RecipeDetailPage />} />
          <Route path="/recipes" element={<p>Listado</p>} />
        </Routes>
      </MemoryRouter>,
    );

    // El formulario de edición sigue visible (inline, sin Modal) — no desapareció ni fue
    // reemplazado por el detalle de sólo lectura de la variante mobile.
    expect(screen.getByLabelText(/^Nombre de la Receta/i)).toHaveValue(recipe.title);
    expect(screen.getByRole('button', { name: 'Guardar Cambios' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('control: with no form open, changing isDesktop still switches the layout normally, not "stuck"', () => {
    const recipe = buildRecipe();
    vi.mocked(useMediaQuery).mockReturnValue(true);
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();
    mockRecipesForCatalog({ recipes: [recipe], status: 'success' });

    const { rerender } = renderDetailPage(recipe.id);

    // Escritorio: layout de dos columnas, con el buscador de la columna izquierda visible.
    expect(screen.getByRole('textbox', { name: /buscar/i })).toBeInTheDocument();

    vi.mocked(useMediaQuery).mockReturnValue(false);
    rerender(
      <MemoryRouter initialEntries={[`/recipes/${recipe.id}`]}>
        <Routes>
          <Route path="/recipes/:id" element={<RecipeDetailPage />} />
          <Route path="/recipes" element={<p>Listado</p>} />
        </Routes>
      </MemoryRouter>,
    );

    // Mobile: layout de una sola columna, sin el buscador de la columna izquierda.
    expect(screen.queryByRole('textbox', { name: /buscar/i })).not.toBeInTheDocument();
  });
});

// No-regresión explícita (design.md 9.2/9.3): en mobile, nada de lo agregado para escritorio
// debe aparecer, y "Editar" debe seguir abriendo `RecipeForm` DENTRO de un `Modal`, exactamente
// como antes de esta iteración.
describe('RecipeDetailPage — mobile, no-regresión tras agregar el layout de escritorio', () => {
  it('does not render the left-column recipe catalog list nor the desktop-only "Nueva Receta" button, and editing still opens RecipeForm inside a Modal', async () => {
    const recipe = buildRecipe();
    vi.mocked(useMediaQuery).mockReturnValue(false);
    mockDetail({ recipe, status: 'success' });
    mockIngredientsForForm();
    mockRecipesForCatalog({ recipes: [recipe], status: 'success' });
    const user = userEvent.setup();

    renderDetailPage(recipe.id);

    expect(screen.queryByRole('textbox', { name: /buscar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nueva Receta' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: EDIT_LABEL }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Modificar Receta')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Nombre de la Receta/i)).toHaveValue(recipe.title);
  });
});
