import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecipesListPage } from './RecipesListPage';
import { useRecipes } from '../hooks/useRecipes';
import { useIngredients } from '../hooks/useIngredients';
import { useMediaQuery } from '../../../common/hooks/useMediaQuery';
import { recipeService, type Recipe } from '../../../services/recipeService';
import { ingredientService, type Ingredient } from '../../../services/ingredientService';

// NUT-20 (segunda iteración, tester): mismo patrón de mock que
// `MealPlanPage.test.tsx` (mockea `useMealPlan`) — se mockea el hook completo, no el
// servicio, porque esta página consume `useRecipes` directamente y varios de los estados
// requeridos (loading/empty/error forzados de forma puntual e independiente de lo que el
// hook real produciría con una petición real) son más simples y estables de forzar con
// `mockReturnValueOnce`/`mockReturnValue` que reproduciendo cada camino async del hook real.
vi.mock('../hooks/useRecipes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useRecipes')>();
  return {
    ...actual,
    useRecipes: vi.fn(),
  };
});

// NUT-20 (tercera iteración, tester): esta página ahora debe renderizar el `IngredientForm`
// REAL (no mockeado) dentro del modal "Nuevo Ingrediente" — ver
// `IngredientForm.test.tsx` para la cobertura exhaustiva de ese componente. Acá sólo se
// mockea el servicio HTTP que ese formulario real termina llamando, mismo patrón
// `importOriginal` + override de `create` usado en `IngredientForm.test.tsx`.
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

// NUT-20 (cuarta iteración, tester): esta página ahora debe renderizar el `RecipeForm` REAL
// (no el placeholder "Formulario próximamente.") dentro del modal "Nueva Receta" — ver
// `RecipeForm.test.tsx` para la cobertura exhaustiva de ese componente. Mismo criterio que ya
// se usó para `IngredientForm`: acá sólo se mockea el servicio HTTP que el formulario real
// termina llamando, y el hook `useIngredients` (que `RecipeForm` usa para las sugerencias del
// catálogo), no el componente en sí.
vi.mock('../../../services/recipeService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/recipeService')>();
  return {
    ...actual,
    recipeService: {
      ...actual.recipeService,
      create: vi.fn(),
    },
  };
});

vi.mock('../hooks/useIngredients', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useIngredients')>();
  return {
    ...actual,
    useIngredients: vi.fn(),
  };
});

// NUT-20 (octava iteración, tester) — adaptación tablet/desktop (design.md sección 9.4/9.5):
// `useMediaQuery` todavía NO EXISTE (`apps/web/src/common/hooks/useMediaQuery.ts`, ver
// `useMediaQuery.test.ts`). Se mockea el hook completo (no `window.matchMedia`) para poder
// forzar "escritorio"/"mobile" de forma determinística en cada test, mismo criterio que el
// resto de este archivo mockea hooks de dominio en vez de sus dependencias internas. Todo este
// archivo queda ROJO por colección hasta que el módulo exista — es el mismo tipo de rojo ya
// aceptado en iteraciones previas para `RecipeDetailPage.test.tsx` ("módulo inexistente").
vi.mock('../../../common/hooks/useMediaQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../common/hooks/useMediaQuery')>();
  return {
    ...actual,
    useMediaQuery: vi.fn(),
  };
});

function buildIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'ingredient-1',
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

// Completa sólo los campos obligatorios del `IngredientForm` real (ver
// `IngredientForm.test.tsx` para el detalle de cada campo).
async function fillMinimalValidIngredientForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Nombre/i), 'Quinoa');
  await user.selectOptions(screen.getByRole('combobox', { name: /^Tipo/i }), 'GRAIN');
  await user.type(screen.getByLabelText(/Unidad de Medida Habitual/i), 'g');
  await user.type(screen.getByLabelText(/^Calorías/i), '120');
  await user.type(screen.getByLabelText(/^Proteínas/i), '4');
  await user.type(screen.getByLabelText(/^Carbohidratos/i), '21');
  await user.type(screen.getByLabelText(/^Grasas/i), '2');
}

// Completa sólo los campos obligatorios del `RecipeForm` real en modo crear (ver
// `RecipeForm.test.tsx` para el detalle exhaustivo de cada campo/criterio).
async function fillMinimalValidRecipeForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Nombre de la Receta/i), 'Nueva Receta De Prueba');
  // NUT-20 (décima iteración, tester) — corrección de UX pedida directamente por la PO: los
  // chips de categoría muestran la etiqueta traducida (`RECIPE_CATEGORY_LABELS` de
  // `labels.ts`), nunca el valor RAW del enum en inglés/mayúsculas.
  await user.click(screen.getByRole('button', { name: 'Vegano' }));
  await user.type(screen.getByLabelText(/Tiempo de Preparación/i), '10');
  await user.type(screen.getByLabelText(/Tiempo de Cocción/i), '5');
  await user.type(screen.getByLabelText(/^Descripción Breve/i), 'Una descripción breve de prueba.');
  await user.type(screen.getByLabelText(/^Calorías/i), '100');
  await user.type(screen.getByLabelText(/^Proteínas/i), '5');
  await user.type(screen.getByLabelText(/^Carbohidratos/i), '10');
  await user.type(screen.getByLabelText(/^Grasas/i), '2');
  await user.type(screen.getByTestId('ingredient-name-0'), 'Lechuga');
  await user.type(screen.getByTestId('ingredient-quantity-0'), '1');
  await user.type(screen.getByTestId('ingredient-unit-0'), 'unidad');
  await user.type(screen.getByLabelText(/Pasos de Preparación/i), 'Cortar la lechuga.');
}

function mockUseIngredientsForRecipeForm() {
  vi.mocked(useIngredients).mockReturnValue({
    ingredients: [],
    status: 'empty',
    errorMessage: null,
    retry: vi.fn(),
    refetch: vi.fn(),
  });
}

// Fixtures con la forma REAL del contrato cerrado de NUT-61 (ver design.md sección 3 y
// `recipeService.ts`): `categories` es un array (una receta puede pertenecer a más de una
// categoría a la vez) y `nutritionalValues` puede ser `null` (dato histórico, sección 3).
const VEGAN_RECIPE: Recipe = {
  id: 'recipe-vegan',
  title: 'Ensalada Vegana Detox',
  description: 'Una ensalada fresca con vegetales de estación y limón.',
  categories: ['VEGAN'],
  prepMinutes: 10,
  cookMinutes: 0,
  ingredients: [{ name: 'Lechuga', quantity: 1, unit: 'unidad' }],
  instructions: ['Lavar y cortar los vegetales.', 'Mezclar con aderezo.'],
  nutritionalValues: { calories: 180, protein: 6, carbs: 20, fat: 8 },
  properties: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const VEGETARIAN_RECIPE: Recipe = {
  id: 'recipe-vegetarian',
  title: 'Tarta de Verduras',
  description: 'Tarta casera con vegetales de hoja y queso.',
  categories: ['VEGETARIAN'],
  prepMinutes: 20,
  cookMinutes: 35,
  ingredients: [{ name: 'Acelga', quantity: 2, unit: 'taza' }],
  instructions: ['Preparar el relleno.', 'Hornear 35 minutos.'],
  nutritionalValues: { calories: 320, protein: 12, carbs: 30, fat: 14 },
  properties: [],
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

// Receta con MÁS DE UNA categoría a la vez, para probar que aparece bajo cada filtro que la
// incluye, y con `nutritionalValues: null` (dato histórico), para probar que la tarjeta no
// rompe y simplemente omite las calorías.
const HIGH_PROTEIN_GF_RECIPE: Recipe = {
  id: 'recipe-high-protein-gf',
  title: 'Pollo al Horno con Quinoa',
  description: 'Pechuga de pollo al horno con quinoa y vegetales.',
  categories: ['HIGH_PROTEIN', 'GLUTEN_FREE'],
  prepMinutes: 15,
  cookMinutes: 40,
  ingredients: [{ name: 'Pechuga de pollo', quantity: 1, unit: 'unidad' }],
  instructions: ['Marinar el pollo.', 'Hornear 40 minutos.'],
  nutritionalValues: null,
  properties: [],
  createdAt: '2026-01-03T00:00:00.000Z',
  updatedAt: '2026-01-03T00:00:00.000Z',
};

const ALL_RECIPES = [VEGAN_RECIPE, VEGETARIAN_RECIPE, HIGH_PROTEIN_GF_RECIPE];

// NUT-20 (séptima iteración, tester) — Hallazgo 1 (bloqueante) del cuarto review: fixture que
// simula la respuesta REAL del backend de hoy (pre-NUT-61), donde `categories`,
// `nutritionalValues` y `properties` directamente no vienen en el objeto (`undefined`, no
// `[]`/`null`) — distinto del tipo `Recipe` que ya asume el contrato cerrado de NUT-61. El
// `as never` es deliberado: el backend real de hoy no respeta todavía el tipo `Recipe` del
// frontend, y el propio hallazgo pide probar exactamente ese desajuste.
const LEGACY_PRE_NUT61_RECIPE = {
  id: 'recipe-legacy-pre-nut61',
  title: 'Receta Legacy Sin NUT-61',
  description: 'Receta devuelta por el backend real de hoy, sin los campos nuevos de NUT-61.',
  categories: undefined,
  prepMinutes: 5,
  cookMinutes: 10,
  ingredients: [{ name: 'Agua', quantity: 1, unit: 'l' }],
  instructions: ['Hervir el agua.'],
  nutritionalValues: undefined,
  properties: undefined,
  createdAt: '2026-01-04T00:00:00.000Z',
  updatedAt: '2026-01-04T00:00:00.000Z',
} as never as Recipe;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mockUseRecipes(overrides: Partial<ReturnType<typeof useRecipes>>) {
  vi.mocked(useRecipes).mockReturnValue({
    recipes: [],
    status: 'success',
    errorMessage: null,
    retry: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  });
}

// Criterio propio del tester: cada tarjeta expone `data-testid="recipe-card-<id>"` para
// poder verificar contenido puntual (badge, tiempo, calorías) sin ambigüedad frente a los
// chips de filtro, que muestran el mismo texto de categoría en otra parte de la pantalla.
function cardFor(recipe: Recipe) {
  return screen.getByTestId(`recipe-card-${recipe.id}`);
}

// NUT-20 (quinta iteración, tester): a partir de esta iteración, clickear una tarjeta de
// receta debe navegar a `/recipes/{id}` (ver design.md sección 4.1 y consigna del tester),
// lo que implica que `RecipesListPage` va a usar `useNavigate()` de `react-router-dom`. Un
// hook de router sólo funciona dentro de un contexto de `<Router>` — de ahí que TODOS los
// renders de este archivo (no sólo el del nuevo test de navegación) se envuelvan en un
// `MemoryRouter`, para no romper el resto de los tests ya en verde el día que el
// implementer agregue esa navegación. `extraRoute` permite declarar, sólo en el test
// puntual que lo necesita, una ruta adicional de prueba (p. ej. `/recipes/:id`) que
// verifique a dónde navegó realmente la página, sin acoplar el resto de los tests a esa
// ruta extra.
function renderRecipesListPage(extraRoute?: ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/recipes']}>
      <Routes>
        <Route path="/recipes" element={<RecipesListPage />} />
        {extraRoute}
      </Routes>
    </MemoryRouter>,
  );
}

// Ruta de prueba mínima para verificar a qué id navegó la tarjeta clickeada, mismo criterio
// que pide la consigna ("<p>Detalle de {id}</p>").
function RecipeDetailProbe() {
  const { id } = useParams();
  return <p>Detalle de {id}</p>;
}

describe('RecipesListPage', () => {
  beforeEach(() => {
    vi.mocked(useRecipes).mockReset();
    vi.mocked(ingredientService.create).mockReset();
    vi.mocked(recipeService.create).mockReset();
    vi.mocked(useIngredients).mockReset();
    vi.mocked(useMediaQuery).mockReset();
    // Default "mobile" (viewport angosto): todos los tests ya existentes, que no le prestan
    // atención a este hook, deben seguir viendo el comportamiento de mobile sin cambios.
    vi.mocked(useMediaQuery).mockReturnValue(false);
    mockUseIngredientsForRecipeForm();
  });

  it('shows a loading skeleton and no cards while status is "loading"', () => {
    // Incluye recetas ya cargadas a propósito: design.md 4.2 sólo describe "skeleton de
    // tarjetas" para el estado de carga del listado (a diferencia del error, que sí debe
    // conservar datos previos) — el skeleton reemplaza la vista, no conviven ambos.
    mockUseRecipes({ recipes: ALL_RECIPES, status: 'loading' });

    renderRecipesListPage();

    expect(screen.getByTestId('recipes-loading-skeleton')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText(VEGAN_RECIPE.title)).not.toBeInTheDocument();
  });

  it('shows the real empty state (never had recipes) with a call to action to create the first one', () => {
    mockUseRecipes({ recipes: [], status: 'empty' });

    renderRecipesListPage();

    expect(screen.getByText(/todavía no tenés recetas/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /crear receta/i })).toBeInTheDocument();
  });

  it('shows an error message with a retry button that calls retry', async () => {
    const retry = vi.fn();
    mockUseRecipes({
      recipes: [],
      status: 'error',
      errorMessage: 'No pudimos cargar tus recetas. Intentá de nuevo.',
      retry,
    });
    const user = userEvent.setup();

    renderRecipesListPage();

    expect(screen.getByText('No pudimos cargar tus recetas. Intentá de nuevo.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('renders all recipe cards with badge, title, description, total time and calories on success', () => {
    mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });

    renderRecipesListPage();

    expect(screen.getByText(VEGAN_RECIPE.title)).toBeInTheDocument();
    expect(screen.getByText(VEGETARIAN_RECIPE.title)).toBeInTheDocument();
    expect(screen.getByText(HIGH_PROTEIN_GF_RECIPE.title)).toBeInTheDocument();

    expect(screen.getByText(VEGAN_RECIPE.description)).toBeInTheDocument();

    // Tiempo total = prepMinutes + cookMinutes (design.md no especifica el cálculo de forma
    // explícita para la tarjeta del listado; criterio razonable del tester, ver informe
    // final). Formato asumido: "{total} min".
    expect(within(cardFor(VEGAN_RECIPE)).getByText('10 min')).toBeInTheDocument();
    expect(within(cardFor(VEGETARIAN_RECIPE)).getByText('55 min')).toBeInTheDocument();
    expect(within(cardFor(HIGH_PROTEIN_GF_RECIPE)).getByText('55 min')).toBeInTheDocument();

    // Badge de categoría: al menos la primera del array `categories`. NUT-20 (décima
    // iteración, tester) — corrección de UX pedida directamente por la PO: la etiqueta
    // traducida (`RECIPE_CATEGORY_LABELS` de `labels.ts`), nunca el valor RAW del enum.
    expect(within(cardFor(VEGAN_RECIPE)).getByText('Vegano')).toBeInTheDocument();
    expect(within(cardFor(VEGETARIAN_RECIPE)).getByText('Vegetariano')).toBeInTheDocument();
    expect(within(cardFor(HIGH_PROTEIN_GF_RECIPE)).getByText('Alto en Proteína')).toBeInTheDocument();

    // Calorías: sólo si `nutritionalValues` no es null.
    expect(within(cardFor(VEGAN_RECIPE)).getByText('180 kcal')).toBeInTheDocument();
    expect(within(cardFor(VEGETARIAN_RECIPE)).getByText('320 kcal')).toBeInTheDocument();
    expect(within(cardFor(HIGH_PROTEIN_GF_RECIPE)).queryByText(/kcal/)).not.toBeInTheDocument();
  });

  it('does not break when a recipe has nutritionalValues: null, it just omits the calories', () => {
    mockUseRecipes({ recipes: [HIGH_PROTEIN_GF_RECIPE], status: 'success' });

    renderRecipesListPage();

    expect(screen.getByText(HIGH_PROTEIN_GF_RECIPE.title)).toBeInTheDocument();
    expect(screen.queryByText(/kcal/)).not.toBeInTheDocument();
  });

  it('renders a filter chip per distinct category plus "Todas (N)", without duplicates', () => {
    mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });

    renderRecipesListPage();

    // NUT-20 (décima iteración, tester) — corrección de UX pedida directamente por la PO: los
    // chips de filtro muestran la etiqueta traducida (`RECIPE_CATEGORY_LABELS` de
    // `labels.ts`), nunca el valor RAW del enum. El chip "Todas (N)" no cambia (no representa
    // una categoría).
    expect(screen.getByRole('button', { name: 'Todas (3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vegano' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vegetariano' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alto en Proteína' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sin Gluten' })).toBeInTheDocument();

    // Sin duplicados: un único chip por categoría distinta presente en el listado.
    expect(screen.getAllByRole('button', { name: 'Vegano' })).toHaveLength(1);
  });

  it('filters by category, and a recipe with more than one category shows up under each of them', async () => {
    mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });
    const user = userEvent.setup();

    renderRecipesListPage();

    // NUT-20 (décima iteración, tester) — corrección de UX pedida directamente por la PO: se
    // clickea por la etiqueta traducida (`RECIPE_CATEGORY_LABELS` de `labels.ts`), nunca por
    // el valor RAW del enum.
    await user.click(screen.getByRole('button', { name: 'Alto en Proteína' }));

    expect(screen.getByText(HIGH_PROTEIN_GF_RECIPE.title)).toBeInTheDocument();
    expect(screen.queryByText(VEGAN_RECIPE.title)).not.toBeInTheDocument();
    expect(screen.queryByText(VEGETARIAN_RECIPE.title)).not.toBeInTheDocument();

    // La misma receta también aparece bajo su OTRA categoría (`GLUTEN_FREE` → "Sin Gluten").
    await user.click(screen.getByRole('button', { name: 'Sin Gluten' }));

    expect(screen.getByText(HIGH_PROTEIN_GF_RECIPE.title)).toBeInTheDocument();
    expect(screen.queryByText(VEGAN_RECIPE.title)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Todas (3)' }));

    expect(screen.getByText(VEGAN_RECIPE.title)).toBeInTheDocument();
    expect(screen.getByText(VEGETARIAN_RECIPE.title)).toBeInTheDocument();
    expect(screen.getByText(HIGH_PROTEIN_GF_RECIPE.title)).toBeInTheDocument();
  });

  it('filters by name search, case-insensitively, and shows a distinct "no results" message when nothing matches', async () => {
    mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });
    const user = userEvent.setup();

    renderRecipesListPage();

    const searchInput = screen.getByRole('textbox', { name: /buscar/i });
    await user.type(searchInput, 'TARTA');

    expect(screen.getByText(VEGETARIAN_RECIPE.title)).toBeInTheDocument();
    expect(screen.queryByText(VEGAN_RECIPE.title)).not.toBeInTheDocument();
    expect(screen.queryByText(HIGH_PROTEIN_GF_RECIPE.title)).not.toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, 'inexistente-xyz');

    expect(screen.queryByText(VEGAN_RECIPE.title)).not.toBeInTheDocument();
    expect(screen.queryByText(VEGETARIAN_RECIPE.title)).not.toBeInTheDocument();
    expect(screen.queryByText(HIGH_PROTEIN_GF_RECIPE.title)).not.toBeInTheDocument();

    // Vacío-por-búsqueda, DISTINTO del mensaje de vacío real (design.md sección 4.2).
    expect(screen.getByText(/no encontramos recetas/i)).toBeInTheDocument();
    expect(screen.queryByText(/todavía no tenés recetas/i)).not.toBeInTheDocument();
  });

  it('calls refetch when the manual update button is clicked', async () => {
    const refetch = vi.fn();
    mockUseRecipes({ recipes: ALL_RECIPES, status: 'success', refetch });
    const user = userEvent.setup();

    renderRecipesListPage();

    await user.click(screen.getByRole('button', { name: 'Actualizar' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('opens a modal to create a recipe when the circular "+" button is clicked', async () => {
    mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });
    const user = userEvent.setup();

    renderRecipesListPage();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Crear receta' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Nueva Receta')).toBeInTheDocument();
  });

  it('renders the real RecipeForm (mode="create") inside the "Nueva Receta" modal, not the old placeholder', async () => {
    mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });
    const user = userEvent.setup();

    renderRecipesListPage();

    await user.click(screen.getByRole('button', { name: 'Crear receta' }));

    const dialog = await screen.findByRole('dialog');
    // Campo característico del formulario real (ver `RecipeForm.test.tsx`): si esto falla,
    // el modal todavía muestra el placeholder "Formulario próximamente." en vez del
    // `RecipeForm` real en modo `create`.
    expect(within(dialog).getByLabelText(/^Nombre de la Receta/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Guardar Receta' })).toBeInTheDocument();
    expect(within(dialog).queryByText(/Formulario próximamente/i)).not.toBeInTheDocument();
  });

  it('closes the "Nueva Receta" modal after successfully submitting the recipe form', async () => {
    mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });
    vi.mocked(recipeService.create).mockResolvedValue(VEGAN_RECIPE);
    const user = userEvent.setup();

    renderRecipesListPage();

    await user.click(screen.getByRole('button', { name: 'Crear receta' }));
    await screen.findByRole('dialog');

    await fillMinimalValidRecipeForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  // NUT-20 (sexta iteración, tester): bug encontrado — a diferencia de editar/borrar (que
  // navegan a otra ruta y remontan la página), crear una receta sólo cierra el modal pero
  // nunca refresca `useRecipes`, por lo que el listado sigue mostrando datos viejos hasta
  // que el usuario clickea "Actualizar" a mano. Esto no cumple el criterio de aceptación
  // ("el listado se actualiza después de crear"). Este test debe fallar en rojo hasta que
  // el `onSuccess` del `RecipeForm` en modo `create` también invoque `refetch`.
  it('refetches the recipe list after successfully submitting the "Nueva Receta" form', async () => {
    const refetch = vi.fn();
    mockUseRecipes({ recipes: ALL_RECIPES, status: 'success', refetch });
    vi.mocked(recipeService.create).mockResolvedValue(VEGAN_RECIPE);
    const user = userEvent.setup();

    renderRecipesListPage();

    await user.click(screen.getByRole('button', { name: 'Crear receta' }));
    await screen.findByRole('dialog');

    await fillMinimalValidRecipeForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('opens a modal to create a standalone ingredient when the "+ Ingrediente" pill is clicked', async () => {
    mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });
    const user = userEvent.setup();

    renderRecipesListPage();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ Ingrediente' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Nuevo Ingrediente')).toBeInTheDocument();
  });

  // NUT-20 (tester, bug real reportado en vivo por la PO) — mismo tipo de hallazgo que el ya
  // cubierto arriba para "Nueva Receta"/`useRecipes().refetch`: hoy el `onSuccess` del
  // `IngredientForm` de este modal sólo hace `setModalKind(null)` (ver `RecipesListPage.tsx`),
  // sin refrescar el catálogo de ingredientes. Esto hoy "funciona" en esta pantalla puntual
  // sólo porque el modal de receta se desmonta/remonta al cerrar y reabrir — pero es frágil y
  // deja el mismo bug latente que sí se manifiesta en `RecipeDetailPage`/`DesktopRecipeDetail`
  // (panel de receta que NO se desmonta). El fix esperado: ese `onSuccess` también debe invocar
  // el `refetch()` de `useIngredients()`. Se espera ROJO hoy: `refetch` nunca se llama.
  it('refetches the ingredient catalog after successfully submitting the "Nuevo Ingrediente" form', async () => {
    mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });
    const ingredientsRefetch = vi.fn();
    vi.mocked(useIngredients).mockReturnValue({
      ingredients: [],
      status: 'empty',
      errorMessage: null,
      retry: vi.fn(),
      refetch: ingredientsRefetch,
    });
    vi.mocked(ingredientService.create).mockResolvedValue(buildIngredient());
    const user = userEvent.setup();

    renderRecipesListPage();

    await user.click(screen.getByRole('button', { name: '+ Ingrediente' }));
    await screen.findByRole('dialog');

    await fillMinimalValidIngredientForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(ingredientsRefetch).toHaveBeenCalledTimes(1);
  });

  it('renders the real IngredientForm inside the "Nuevo Ingrediente" modal, not the old placeholder', async () => {
    mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });
    const user = userEvent.setup();

    renderRecipesListPage();

    await user.click(screen.getByRole('button', { name: '+ Ingrediente' }));

    const dialog = await screen.findByRole('dialog');
    // Campo característico del formulario real (ver `IngredientForm.test.tsx`): si esto
    // falla, el modal todavía muestra el placeholder "Formulario próximamente." en vez del
    // `IngredientForm` real.
    expect(within(dialog).getByLabelText(/^Nombre/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Formulario próximamente/i)).not.toBeInTheDocument();
  });

  it('closes the "Nuevo Ingrediente" modal after successfully submitting the ingredient form', async () => {
    mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });
    vi.mocked(ingredientService.create).mockResolvedValue(buildIngredient());
    const user = userEvent.setup();

    renderRecipesListPage();

    await user.click(screen.getByRole('button', { name: '+ Ingrediente' }));
    await screen.findByRole('dialog');

    await fillMinimalValidIngredientForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('navigates to /recipes/{id} when a recipe card itself is clicked (not a header action button)', async () => {
    mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });
    const user = userEvent.setup();

    renderRecipesListPage(<Route path="/recipes/:id" element={<RecipeDetailProbe />} />);

    await user.click(cardFor(VEGAN_RECIPE));

    expect(await screen.findByText(`Detalle de ${VEGAN_RECIPE.id}`)).toBeInTheDocument();
  });

  // NUT-20 (séptima iteración, tester) — Hallazgo 1 (bloqueante) del cuarto review: el backend
  // real de hoy (pre-NUT-61) puede devolver una receta SIN `categories`/`nutritionalValues`/
  // `properties` (campo directamente ausente, `undefined`). Hoy `recipe.categories.includes`,
  // `recipe.categories[0]` y `recipes.flatMap(r => r.categories)` asumen que esos campos
  // siempre existen, así que rompen con un `TypeError` ante este fixture. Se espera ROJO.
  describe('RecipesListPage — backend real pre-NUT-61 sin categories/nutritionalValues/properties (Hallazgo 1, cuarto review)', () => {
    it('renders that recipe without throwing, without an "undefined" category badge, and without inventing nutritional data', () => {
      mockUseRecipes({ recipes: [LEGACY_PRE_NUT61_RECIPE], status: 'success' });

      expect(() => renderRecipesListPage()).not.toThrow();

      expect(screen.getByText(LEGACY_PRE_NUT61_RECIPE.title)).toBeInTheDocument();
      expect(screen.queryByText('undefined')).not.toBeInTheDocument();
      expect(screen.queryByText(/kcal/)).not.toBeInTheDocument();
    });

    it('does not generate an "undefined" filter chip when some recipe has no categories', () => {
      mockUseRecipes({ recipes: [VEGAN_RECIPE, LEGACY_PRE_NUT61_RECIPE], status: 'success' });

      expect(() => renderRecipesListPage()).not.toThrow();

      expect(screen.queryByRole('button', { name: 'undefined' })).not.toBeInTheDocument();
      // NUT-20 (décima iteración, tester) — corrección de UX pedida directamente por la PO:
      // etiqueta traducida (`RECIPE_CATEGORY_LABELS` de `labels.ts`), nunca el valor RAW del
      // enum.
      expect(screen.getByRole('button', { name: 'Vegano' })).toBeInTheDocument();
    });
  });

  // NUT-20 (séptima iteración, tester) — Hallazgo 2 (bloqueante) del cuarto review: mientras el
  // `RecipeForm`/`IngredientForm` dentro del modal está enviando, hoy el `Modal` sigue siendo
  // cerrable por `Escape` sin ninguna restricción, y la mutación sigue en curso en segundo
  // plano. La corrección: la página debe pasar `dismissible={!isSubmittingRecipe}` /
  // `dismissible={!isSubmittingIngredient}` al `Modal` correspondiente, usando el nuevo
  // callback `onSubmittingChange` del formulario. Se espera ROJO hoy: ninguno de los dos modales
  // recibe todavía esa prop.
  describe('RecipesListPage — Modal no dismissible mientras el formulario envía (Hallazgo 2, cuarto review)', () => {
    it('the "Nueva Receta" modal does not close via Escape while the recipe save is still pending', async () => {
      mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });
      const { promise } = createDeferred<Recipe>();
      vi.mocked(recipeService.create).mockReturnValue(promise);
      const user = userEvent.setup();

      renderRecipesListPage();

      await user.click(screen.getByRole('button', { name: 'Crear receta' }));
      await screen.findByRole('dialog');

      await fillMinimalValidRecipeForm(user);
      await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

      // La promesa de `recipeService.create` sigue sin resolver: el guardado está en curso.
      await user.keyboard('{Escape}');

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('the "Nuevo Ingrediente" modal does not close via Escape while the ingredient save is still pending', async () => {
      mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });
      const { promise } = createDeferred<Ingredient>();
      vi.mocked(ingredientService.create).mockReturnValue(promise);
      const user = userEvent.setup();

      renderRecipesListPage();

      await user.click(screen.getByRole('button', { name: '+ Ingrediente' }));
      await screen.findByRole('dialog');

      await fillMinimalValidIngredientForm(user);
      await user.click(screen.getByRole('button', { name: 'Guardar Ingrediente' }));

      // La promesa de `ingredientService.create` sigue sin resolver: el guardado está en curso.
      await user.keyboard('{Escape}');

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  // NUT-20 (octava iteración, tester) — adaptación tablet/desktop (design.md sección 9.4/9.5):
  // en viewport de escritorio (`useMediaQuery` en `true`) con recetas ya cargadas, esta página
  // nunca debe quedarse mostrando el listado "puro" — redirige de inmediato a
  // `/recipes/{primera receta}`, REEMPLAZANDO la entrada de historial (`replace: true`), no
  // agregando una nueva. En mobile, o con el listado vacío (nada a dónde redirigir), sigue
  // mostrando el listado tal como hoy. Se espera ROJO hoy: `useMediaQuery` no existe todavía
  // como módulo, y `RecipesListPage` todavía no redirige en absoluto.
  describe('RecipesListPage — redirección automática en escritorio (design.md 9.4/9.5)', () => {
    // Ruta de prueba con un botón "Volver atrás" que usa `navigate(-1)`: es la forma
    // determinística de distinguir `replace: true` de un `push` sin depender de inspeccionar
    // el historial interno de `MemoryRouter`. Si la redirección usó `replace: true`, la entrada
    // `/recipes` queda REEMPLAZADA (no hay ninguna entrada anterior a la que volver, así que
    // "Volver atrás" no cambia nada). Si en cambio usara `push` (comportamiento incorrecto),
    // "Volver atrás" volvería a mostrar el listado en `/recipes`.
    function DetailWithBackProbe() {
      const { id } = useParams();
      const navigate = useNavigate();
      return (
        <div>
          <p>{`Detalle de ${id}`}</p>
          <button type="button" onClick={() => navigate(-1)}>
            Volver atrás (test)
          </button>
        </div>
      );
    }

    function renderWithDetailRoute() {
      return render(
        <MemoryRouter initialEntries={['/recipes']}>
          <Routes>
            <Route path="/recipes" element={<RecipesListPage />} />
            <Route path="/recipes/:id" element={<DetailWithBackProbe />} />
          </Routes>
        </MemoryRouter>,
      );
    }

    it('redirects to /recipes/{firstId} with replace:true when the viewport is desktop and recipes are already loaded', async () => {
      vi.mocked(useMediaQuery).mockReturnValue(true);
      mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });
      const user = userEvent.setup();

      renderWithDetailRoute();

      expect(await screen.findByText(`Detalle de ${VEGAN_RECIPE.id}`)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Volver atrás (test)' }));

      expect(screen.getByText(`Detalle de ${VEGAN_RECIPE.id}`)).toBeInTheDocument();
    });

    it('does NOT redirect when the viewport is mobile, even with recipes already loaded', () => {
      vi.mocked(useMediaQuery).mockReturnValue(false);
      mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });

      renderWithDetailRoute();

      expect(screen.getByText(VEGAN_RECIPE.title)).toBeInTheDocument();
      expect(screen.queryByText(/Detalle de/)).not.toBeInTheDocument();
    });

    it('does NOT redirect on desktop when the recipe list is empty (there is nowhere to redirect to)', () => {
      vi.mocked(useMediaQuery).mockReturnValue(true);
      mockUseRecipes({ recipes: [], status: 'empty' });

      renderWithDetailRoute();

      // Bug 4 (design.md 9.4/9.5): con el catálogo vacío, escritorio arma el layout de dos
      // columnas (una ocurrencia del estado vacío por columna) en vez de una sola — mismo
      // criterio que el describe "escritorio, catálogo vacío arma el layout de dos columnas"
      // más abajo en este archivo. Lo que este test verifica sigue intacto: NO hubo redirect.
      expect(screen.getAllByText(/todavía no tenés recetas/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText(/Detalle de/)).not.toBeInTheDocument();
    });
  });

  // NUT-20 (novena iteración, tester) — Hallazgo 4 (alto): revisión de la adaptación desktop. Al
  // cargar `/recipes` directo en escritorio con recetas ya cargadas, hoy el render SINCRÓNICO (el
  // que corre antes de que el `useEffect` de redirección llegue a dispararse) pinta el listado
  // mobile completo — buscador, chips, tarjetas y FAB — durante al menos un frame, antes de que
  // `navigate()` reemplace la pantalla por el detalle de escritorio. La corrección esperada
  // (implementer): en el MISMO render donde ya se cumple la condición de redirect
  // (`isDesktop && status === 'success' && recipes.length > 0`), el componente debe devolver el
  // skeleton de carga en vez del listado completo. Se verifica inmediatamente después de
  // `render()`, sin ningún `waitFor`/`findBy` de por medio (que sí dejarían correr el efecto) —
  // mismo criterio ya usado por los tests de "redirección automática" de arriba, que necesitan
  // `findByText` (asíncrono) porque el contenido post-redirect todavía no está en el DOM justo
  // después de `render()`. Se espera ROJO hoy: el listado completo (tarjeta y buscador) sí se ve
  // en ese render sincrónico.
  describe('RecipesListPage — evita el salto de layout mientras redirige en escritorio (Hallazgo 4, novena iteración)', () => {
    it('shows the loading skeleton, not the full mobile list, in the synchronous render before the desktop redirect effect runs', () => {
      vi.mocked(useMediaQuery).mockReturnValue(true);
      mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });

      renderRecipesListPage();

      expect(screen.queryByTestId(`recipe-card-${VEGAN_RECIPE.id}`)).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: /buscar/i })).not.toBeInTheDocument();
      expect(screen.getByTestId('recipes-loading-skeleton')).toBeInTheDocument();
    });
  });

  // NUT-20 (bug 4 confirmado por revisión de código) — design.md 9.4/9.5 (líneas 303/343/353):
  // "Si el listado está vacío, `/recipes` se queda tal cual, mostrando el layout de dos
  // columnas con el estado vacío de 9.4 en el panel derecho". Hoy `shouldRedirectToDesktopDetail`
  // sólo es `true` con `status === 'success' && recipes.length > 0`; con el catálogo REALMENTE
  // vacío (`status: 'empty'`) en escritorio, la página no arma ningún layout de dos columnas —
  // sólo renderiza `RecipeCatalogList` (que ya muestra su propio estado vacío, mensaje + CTA)
  // dentro del mismo `<main>` de una sola columna que usa mobile, sin ningún panel derecho.
  // Criterio propio del tester (sin testid nuevo, misma convención de queries por rol/texto ya
  // usada en el resto de este archivo): la columna izquierda sigue siendo `RecipeCatalogList`
  // montado (que en este estado sólo puede mostrarse a sí mismo vía su propio "Todavía no tenés
  // recetas" + "Crear receta", ver `RecipeCatalogList.tsx`), y el panel derecho de escritorio
  // agrega ESE MISMO mensaje/CTA una segunda vez (equivalente de escritorio del estado vacío de
  // 4.2) — por lo que en escritorio con catálogo vacío deben verse DOS ocurrencias del mensaje y
  // DOS botones "Crear receta" (una por columna), no una sola como hoy. Se espera ROJO: hoy sólo
  // hay una ocurrencia (el layout de una sola columna, igual que mobile).
  describe('RecipesListPage — escritorio, catálogo vacío arma el layout de dos columnas (Bug 4, design.md 9.4/9.5)', () => {
    it('keeps the left-column recipe list mounted and shows a desktop empty state in the right panel at the same time, instead of collapsing to the single-column mobile screen', () => {
      vi.mocked(useMediaQuery).mockReturnValue(true);
      mockUseRecipes({ recipes: [], status: 'empty' });

      renderRecipesListPage();

      expect(screen.getAllByText(/todavía no tenés recetas/i)).toHaveLength(2);
      expect(screen.getAllByRole('button', { name: /crear receta/i })).toHaveLength(2);
    });
  });

  // NUT-20 (novena iteración, tester) — Hallazgo 2 (alto): revisión de la adaptación desktop.
  // Hoy `RecipesListPage` sólo usa `modalKind` (no hay equivalente a `panelMode`), y su
  // `useEffect` de redirección a escritorio depende de `isDesktop` sin mirar si hay un
  // formulario de receta abierto. Si `isDesktop` pasa a `true` MIENTRAS el modal "Nueva Receta"
  // está abierto (resize/rotación), ese efecto dispara `navigate(..., { replace: true })` y
  // desmonta la página completa (Modal incluido), perdiendo el formulario sin avisar — el mismo
  // síntoma general del Hallazgo 2, aplicado a esta pantalla en concreto. La corrección esperada
  // (implementer): congelar la decisión de a qué rama moverse (acá, si corresponde redirigir o
  // no) mientras el formulario siga abierto, hasta que se cierre/guarde/cancele. Mismo criterio
  // de `rerender(...)` que el resto de este archivo para simular un resize en caliente. Se
  // espera ROJO hoy: tras el resize, la página navega a `/recipes/{id}` y el modal desaparece.
  // NUT-20 (ajuste visual pedido directamente por la PO, comparando la app real contra los
  // mockups de Stitch de la pantalla de recetas). Dos decisiones ya tomadas por la PO, no se
  // reabren acá:
  //   1. El header pasa de `<h1>Recetas</h1>` + "Actualizar" a: ícono + título "NutrIA" +
  //      subtítulo "Recetario & Catálogo" (ambos como texto visible), con el botón
  //      "+ Ingrediente" (que hoy vive como chip dentro de `RecipeCatalogList`) movido a ese
  //      mismo header, fuera de la fila de chips de categoría. El botón "Actualizar" se muda a
  //      una fila nueva ("N RECETAS DISPONIBLES" + "Actualizar"), debajo de los chips y antes
  //      de la lista de tarjetas.
  //   2. Cada categoría tendrá un color de badge distinto (ver `labels.test.ts` para
  //      `RECIPE_CATEGORY_BADGE_CLASSES`; no cubierto en este archivo).
  // Se espera ROJO hoy en los tres tests de este bloque: ninguno de estos elementos existe
  // todavía en `RecipesListPage.tsx`/`RecipeCatalogList.tsx`.
  describe('RecipesListPage — rediseño de header y catálogo (ajuste visual NUT-20)', () => {
    it('shows "NutrIA" as the title and "Recetario & Catálogo" as the subtitle in the header', () => {
      mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });

      renderRecipesListPage();

      expect(screen.getByText('NutrIA')).toBeInTheDocument();
      expect(screen.getByText('Recetario & Catálogo')).toBeInTheDocument();
    });

    // Criterio del tester para declarar sin ambigüedad "el header" vs. "la fila de chips de
    // categoría", ya que ambos pueden contener en algún momento un elemento con texto/aria
    // que matchee /ingrediente/i: dos testids nuevos a introducir por el implementer,
    // documentados acá porque no hay ningún marcador existente que distinga esos dos
    // contenedores hoy.
    //   - `recipes-header` en `RecipesListPage.tsx`: envuelve ícono + "NutrIA" +
    //     "Recetario & Catálogo" + el botón "+ Ingrediente" reubicado.
    //   - `recipe-category-chips` en `RecipeCatalogList.tsx`: envuelve la fila de chips de
    //     categoría (el mismo `<div>` que hoy ya contiene el chip "Todas (N)").
    it('places the "+ Ingrediente" action in the header, outside the category chip row', () => {
      mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });

      renderRecipesListPage();

      const chipsRow = screen.getByTestId('recipe-category-chips');
      // Confirma que efectivamente encontramos la fila de chips correcta (sigue conteniendo
      // el chip "Todas (N)" de siempre).
      expect(within(chipsRow).getByRole('button', { name: 'Todas (3)' })).toBeInTheDocument();
      expect(within(chipsRow).queryByRole('button', { name: /ingrediente/i })).not.toBeInTheDocument();

      const header = screen.getByTestId('recipes-header');
      expect(within(header).getByRole('button', { name: /ingrediente/i })).toBeInTheDocument();
    });

    it('shows an "N RECETAS DISPONIBLES" count below the category chips, and its "Actualizar" action still calls refetch', async () => {
      const refetch = vi.fn();
      mockUseRecipes({ recipes: ALL_RECIPES, status: 'success', refetch });
      const user = userEvent.setup();

      renderRecipesListPage();

      expect(screen.getByText(/3 recetas disponibles/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Actualizar' }));

      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('RecipesListPage — freeze de layout mientras el formulario de "Nueva Receta" está abierto (Hallazgo 2, novena iteración)', () => {
    function RecipeDetailFreezeProbe() {
      const { id } = useParams();
      return <p>{`Detalle de ${id}`}</p>;
    }

    it('keeps the "Nueva Receta" modal open, without navigating away, if isDesktop flips to true while it is open', async () => {
      vi.mocked(useMediaQuery).mockReturnValue(false);
      mockUseRecipes({ recipes: ALL_RECIPES, status: 'success' });
      const user = userEvent.setup();

      const { rerender } = renderRecipesListPage(
        <Route path="/recipes/:id" element={<RecipeDetailFreezeProbe />} />,
      );

      await user.click(screen.getByRole('button', { name: 'Crear receta' }));
      const dialog = await screen.findByRole('dialog');
      await user.type(
        within(dialog).getByLabelText(/^Nombre de la Receta/i),
        'Receta a medio completar',
      );

      // Simula un resize a escritorio MIENTRAS el modal de "Nueva Receta" sigue abierto.
      vi.mocked(useMediaQuery).mockReturnValue(true);
      rerender(
        <MemoryRouter initialEntries={['/recipes']}>
          <Routes>
            <Route path="/recipes" element={<RecipesListPage />} />
            <Route path="/recipes/:id" element={<RecipeDetailFreezeProbe />} />
          </Routes>
        </MemoryRouter>,
      );

      // El modal sigue abierto e intacto: no navegó a /recipes/{id} ni perdió lo ya tipeado.
      expect(screen.queryByText(/Detalle de/)).not.toBeInTheDocument();
      const stillOpenDialog = screen.getByRole('dialog');
      expect(within(stillOpenDialog).getByLabelText(/^Nombre de la Receta/i)).toHaveValue(
        'Receta a medio completar',
      );
    });
  });
});
