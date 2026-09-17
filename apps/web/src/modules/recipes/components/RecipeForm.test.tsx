import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecipeForm } from './RecipeForm';
import {
  recipeService,
  RecipeRequestError,
  type CreateRecipeRequest,
  type Recipe,
  type UpdateRecipeRequest,
} from '../../../services/recipeService';
import { useIngredients } from '../hooks/useIngredients';
import type { Ingredient } from '../../../services/ingredientService';

// NUT-20 (cuarta iteración, tester) — `RecipeForm` todavía NO EXISTE. Reemplaza el
// placeholder `<p>Formulario próximamente.</p>` que hoy muestra el modal "Nueva Receta" de
// `RecipesListPage` (ver design.md secciones 2/5, `CreateRecipeRequest` real en
// `recipeService.ts`, y el mismo estilo/convenciones ya usadas por `IngredientForm`). Se
// espera ROJO hoy por módulo inexistente.
//
// Mismo patrón de mock que `IngredientForm.test.tsx`: se mockea el servicio completo con
// `importOriginal` + override de los métodos usados (`create`/`update`). Además se mockea el
// hook `useIngredients` directamente (no el servicio de ingredientes), porque este
// componente sólo lo consume para ofrecer sugerencias de nombre — no depende de la forma
// interna del servicio.
vi.mock('../../../services/recipeService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/recipeService')>();
  return {
    ...actual,
    recipeService: {
      ...actual.recipeService,
      create: vi.fn(),
      update: vi.fn(),
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

// --- Criterios propios del tester (documentados en el informe final) --------------------
//
// - Categorías: chips con la ETIQUETA TRADUCIDA al español de `RECIPE_CATEGORY_LABELS`
//   (`labels.ts`, p. ej. "Vegano" para `RecipeCategory: 'VEGAN'`), no el valor RAW del enum
//   — corrección de UX pedida directamente por la PO (décima iteración): el enum crudo en
//   inglés/mayúsculas no puede quedar visible en producción
//   (`screen.getByRole('button', { name: 'Vegano' })`). El VALOR interno que viaja en el
//   payload sigue siendo el enum crudo (`RecipeCategory`), nunca la traducción. Selección
//   expuesta vía `aria-pressed` (mismo contrato que `Pill.tsx`, sugerido tal cual por
//   plan.md sección 3 para estos chips).
// - Tiempos de preparación/cocción: dos inputs numéricos SEPARADOS (`type="text"
//   inputMode="decimal"`), ambos obligatorios, validados igual que los campos numéricos
//   obligatorios de `IngredientForm` (>= 0, no sólo > 0) — la propia fixture de
//   `RecipesListPage.test.tsx` tiene una receta real con `cookMinutes: 0`.
// - Filas de ingrediente: no tienen `<label>` propio (evita colisión de `id`/label entre
//   filas repetidas); se identifican por `data-testid`: `ingredient-row-{index}`,
//   `ingredient-name-{index}`, `ingredient-quantity-{index}`, `ingredient-unit-{index}`,
//   `remove-ingredient-row-{index}`, `error-ingredient-row-{index}`. Cantidad validada como
//   numérica > 0 (a diferencia de los tiempos, acá sí se pide estrictamente mayor a 0, tal
//   como indica la consigna).
// - Datalist de sugerencias: un único `<datalist>` compartido por todas las filas, con un
//   `id` fijo referenciado por el atributo `list` de cada input de nombre.
// - "Pasos de Preparación": una textarea de texto libre; en modo editar se reconstruye
//   uniendo `instructions` con `\n`; al enviar se vuelve a partir por línea, se recortan
//   espacios y se descartan líneas vacías.
// - "Propiedades y Restricciones": mismo criterio de serialización que `IngredientForm`
//   (split por coma, trim, descarta vacíos); en modo editar se reconstruye con `join(', ')`.
const REQUIRED_TEXT_ERROR = 'Este campo es obligatorio.';
const REQUIRED_CATEGORY_ERROR = 'Seleccioná al menos una categoría.';
const INVALID_NUMBER_ERROR = 'Ingresá un valor numérico mayor o igual a 0.';
const INGREDIENTS_REQUIRED_ERROR = 'Agregá al menos un ingrediente completo.';
const INGREDIENT_ROW_INCOMPLETE_ERROR = 'Completá nombre, cantidad y unidad para esta fila.';
const INSTRUCTIONS_REQUIRED_ERROR = 'Agregá al menos un paso de preparación.';
const VALIDATION_ERROR = 'Revisá los campos del formulario e intentá de nuevo.';
const CONNECTIVITY_ERROR = 'No pudimos conectar. Revisá tu conexión e intentá de nuevo.';
const UNEXPECTED_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';

// NUT-20 (décima iteración, tester) — corrección de UX pedida directamente por la PO: las
// categorías se muestran con la etiqueta traducida al español (`RECIPE_CATEGORY_LABELS` de
// `labels.ts`), nunca con el valor RAW del enum en inglés/mayúsculas.
const ALL_CATEGORY_LABELS = [
  'Vegano',
  'Vegetariano',
  'Alto en Proteína',
  'Sin Gluten',
  'Sin Lácteos',
  'Bajo en Carbohidratos',
  'Otra',
];

function buildCatalogIngredients(): Ingredient[] {
  return [
    {
      id: 'ingredient-1',
      name: 'Quinoa',
      description: 'Cereal andino sin gluten',
      type: 'GRAIN',
      defaultUnit: 'g',
      nutritionalValues: { calories: 120, protein: 4, carbs: 21, fat: 2 },
      properties: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 'ingredient-2',
      name: 'Lechuga',
      description: null,
      type: 'VEGETABLE',
      defaultUnit: 'unidad',
      nutritionalValues: { calories: 15, protein: 1, carbs: 3, fat: 0 },
      properties: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 'ingredient-3',
      name: 'Tomate',
      description: null,
      type: 'VEGETABLE',
      defaultUnit: 'unidad',
      nutritionalValues: { calories: 18, protein: 1, carbs: 4, fat: 0 },
      properties: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ];
}

function mockUseIngredients(overrides: Partial<ReturnType<typeof useIngredients>> = {}) {
  vi.mocked(useIngredients).mockReturnValue({
    ingredients: buildCatalogIngredients(),
    status: 'success',
    errorMessage: null,
    retry: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  });
}

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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function nameInputs() {
  return screen.getAllByTestId(/^ingredient-name-\d+$/);
}

function quantityInputs() {
  return screen.getAllByTestId(/^ingredient-quantity-\d+$/);
}

function unitInputs() {
  return screen.getAllByTestId(/^ingredient-unit-\d+$/);
}

function removeRowButtons() {
  return screen.getAllByTestId(/^remove-ingredient-row-\d+$/);
}

async function fillIngredientRow(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  values: { name: string; quantity: string; unit: string },
) {
  await user.type(screen.getByTestId(`ingredient-name-${index}`), values.name);
  await user.type(screen.getByTestId(`ingredient-quantity-${index}`), values.quantity);
  await user.type(screen.getByTestId(`ingredient-unit-${index}`), values.unit);
}

// Completa un formulario mínimo y válido en modo crear: un único título, una categoría, los
// dos tiempos, la descripción, los 4 valores nutricionales obligatorios, la única fila de
// ingredientes por defecto, y un paso de preparación. Propiedades queda sin tocar (opcional).
async function fillMinimalValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Nombre de la Receta/i), 'Nueva Receta De Prueba');
  await user.click(screen.getByRole('button', { name: 'Vegano' }));
  await user.type(screen.getByLabelText(/Tiempo de Preparación/i), '10');
  await user.type(screen.getByLabelText(/Tiempo de Cocción/i), '5');
  await user.type(screen.getByLabelText(/^Descripción Breve/i), 'Una descripción breve de prueba.');
  await user.type(screen.getByLabelText(/^Calorías/i), '100');
  await user.type(screen.getByLabelText(/^Proteínas/i), '5');
  await user.type(screen.getByLabelText(/^Carbohidratos/i), '10');
  await user.type(screen.getByLabelText(/^Grasas/i), '2');
  await fillIngredientRow(user, 0, { name: 'Lechuga', quantity: '1', unit: 'unidad' });
  await user.type(screen.getByLabelText(/Pasos de Preparación/i), 'Cortar la lechuga.');
}

function lastCreatePayload(): CreateRecipeRequest | undefined {
  const calls = vi.mocked(recipeService.create).mock.calls;
  return calls[calls.length - 1]?.[0];
}

function lastUpdateCall(): [string, UpdateRecipeRequest] | undefined {
  const calls = vi.mocked(recipeService.update).mock.calls;
  const call = calls[calls.length - 1];
  return call ? [call[0], call[1]] : undefined;
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('RecipeForm — modo crear, formulario vacío', () => {
  it('arranca con todos los campos vacíos/sin selección y el botón dice "Guardar Receta"', () => {
    mockUseIngredients();
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/^Nombre de la Receta/i)).toHaveValue('');

    for (const label of ALL_CATEGORY_LABELS) {
      const chip = screen.getByRole('button', { name: label });
      expect(chip).toHaveAttribute('aria-pressed', 'false');
    }

    expect(screen.getByLabelText(/Tiempo de Preparación/i)).toHaveValue('');
    expect(screen.getByLabelText(/Tiempo de Cocción/i)).toHaveValue('');
    expect(screen.getByLabelText(/^Descripción Breve/i)).toHaveValue('');
    expect(screen.getByLabelText(/^Calorías/i)).toHaveValue('');
    expect(screen.getByLabelText(/^Proteínas/i)).toHaveValue('');
    expect(screen.getByLabelText(/^Carbohidratos/i)).toHaveValue('');
    expect(screen.getByLabelText(/^Grasas/i)).toHaveValue('');

    expect(nameInputs()).toHaveLength(1);
    expect(nameInputs()[0]).toHaveValue('');
    expect(quantityInputs()[0]).toHaveValue('');
    expect(unitInputs()[0]).toHaveValue('');

    expect(screen.getByLabelText(/Pasos de Preparación/i)).toHaveValue('');
    expect(screen.getByLabelText(/Propiedades y Restricciones/i)).toHaveValue('');

    expect(screen.getByRole('button', { name: 'Guardar Receta' })).toBeInTheDocument();
  });
});

describe('RecipeForm — modo editar, precarga', () => {
  it('precarga todos los campos desde initialValues y el botón dice "Guardar Cambios"', () => {
    mockUseIngredients();
    const recipe = buildRecipe();
    render(
      <RecipeForm
        mode="edit"
        initialValues={recipe}
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/^Nombre de la Receta/i)).toHaveValue(recipe.title);

    expect(screen.getByRole('button', { name: 'Vegano' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sin Gluten' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Vegetariano' })).toHaveAttribute('aria-pressed', 'false');

    expect(screen.getByLabelText(/Tiempo de Preparación/i)).toHaveValue(String(recipe.prepMinutes));
    expect(screen.getByLabelText(/Tiempo de Cocción/i)).toHaveValue(String(recipe.cookMinutes));
    expect(screen.getByLabelText(/^Descripción Breve/i)).toHaveValue(recipe.description);

    expect(screen.getByLabelText(/^Calorías/i)).toHaveValue('180');
    expect(screen.getByLabelText(/^Proteínas/i)).toHaveValue('6');
    expect(screen.getByLabelText(/^Carbohidratos/i)).toHaveValue('20');
    expect(screen.getByLabelText(/^Grasas/i)).toHaveValue('8');

    expect(nameInputs()).toHaveLength(2);
    expect(screen.getByTestId('ingredient-name-0')).toHaveValue('Lechuga');
    expect(screen.getByTestId('ingredient-quantity-0')).toHaveValue('1');
    expect(screen.getByTestId('ingredient-unit-0')).toHaveValue('unidad');
    expect(screen.getByTestId('ingredient-name-1')).toHaveValue('Tomate');
    expect(screen.getByTestId('ingredient-quantity-1')).toHaveValue('2');
    expect(screen.getByTestId('ingredient-unit-1')).toHaveValue('kg');

    expect(screen.getByLabelText(/Pasos de Preparación/i)).toHaveValue(
      'Lavar y cortar los vegetales.\nMezclar con aderezo.',
    );
    expect(screen.getByLabelText(/Propiedades y Restricciones/i)).toHaveValue('Vegano, Sin Gluten');

    expect(screen.getByRole('button', { name: 'Guardar Cambios' })).toBeInTheDocument();
  });
});

describe('RecipeForm — validación de campos obligatorios', () => {
  it('no llama a recipeService.create y marca cada campo obligatorio al enviar el formulario en blanco', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

    expect(recipeService.create).not.toHaveBeenCalled();

    expect(screen.getByTestId('error-title')).toHaveTextContent(REQUIRED_TEXT_ERROR);
    expect(screen.getByTestId('error-categories')).toHaveTextContent(REQUIRED_CATEGORY_ERROR);
    expect(screen.getByTestId('error-prepMinutes')).toHaveTextContent(INVALID_NUMBER_ERROR);
    expect(screen.getByTestId('error-cookMinutes')).toHaveTextContent(INVALID_NUMBER_ERROR);
    expect(screen.getByTestId('error-description')).toHaveTextContent(REQUIRED_TEXT_ERROR);
    expect(screen.getByTestId('error-calories')).toHaveTextContent(INVALID_NUMBER_ERROR);
    expect(screen.getByTestId('error-protein')).toHaveTextContent(INVALID_NUMBER_ERROR);
    expect(screen.getByTestId('error-carbs')).toHaveTextContent(INVALID_NUMBER_ERROR);
    expect(screen.getByTestId('error-fat')).toHaveTextContent(INVALID_NUMBER_ERROR);
    expect(screen.getByTestId('error-ingredients')).toHaveTextContent(INGREDIENTS_REQUIRED_ERROR);
    expect(screen.getByTestId('error-instructions')).toHaveTextContent(INSTRUCTIONS_REQUIRED_ERROR);
  });
});

describe('RecipeForm — multi-select de categorías', () => {
  it('permite seleccionar varias, deseleccionar una ya seleccionada, y envía el array exacto elegido', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    vi.mocked(recipeService.create).mockResolvedValue(buildRecipe());
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Vegano' }));
    await user.click(screen.getByRole('button', { name: 'Sin Gluten' }));

    expect(screen.getByRole('button', { name: 'Vegano' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sin Gluten' })).toHaveAttribute('aria-pressed', 'true');

    // Deselecciona "VEGAN": vuelve a quedar sin marcar.
    await user.click(screen.getByRole('button', { name: 'Vegano' }));
    expect(screen.getByRole('button', { name: 'Vegano' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Sin Gluten' })).toHaveAttribute('aria-pressed', 'true');

    await user.type(screen.getByLabelText(/^Nombre de la Receta/i), 'Receta Sin Gluten');
    await user.type(screen.getByLabelText(/Tiempo de Preparación/i), '10');
    await user.type(screen.getByLabelText(/Tiempo de Cocción/i), '5');
    await user.type(screen.getByLabelText(/^Descripción Breve/i), 'Descripción breve.');
    await user.type(screen.getByLabelText(/^Calorías/i), '100');
    await user.type(screen.getByLabelText(/^Proteínas/i), '5');
    await user.type(screen.getByLabelText(/^Carbohidratos/i), '10');
    await user.type(screen.getByLabelText(/^Grasas/i), '2');
    await fillIngredientRow(user, 0, { name: 'Lechuga', quantity: '1', unit: 'unidad' });
    await user.type(screen.getByLabelText(/Pasos de Preparación/i), 'Cortar la lechuga.');

    await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

    await waitFor(() => expect(recipeService.create).toHaveBeenCalledTimes(1));
    expect(lastCreatePayload()?.categories).toEqual(['GLUTEN_FREE']);
  });
});

describe('RecipeForm — filas de ingredientes', () => {
  it('"+ Añadir fila" agrega una fila nueva vacía', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(nameInputs()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '+ Añadir fila' }));

    expect(nameInputs()).toHaveLength(2);
    expect(nameInputs()[1]).toHaveValue('');
    expect(quantityInputs()[1]).toHaveValue('');
    expect(unitInputs()[1]).toHaveValue('');
  });

  it('el botón eliminar saca sólo la fila puntual, no todas', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '+ Añadir fila' }));
    await user.click(screen.getByRole('button', { name: '+ Añadir fila' }));
    expect(nameInputs()).toHaveLength(3);

    await user.type(nameInputs()[0], 'Fila0');
    await user.type(nameInputs()[1], 'Fila1');
    await user.type(nameInputs()[2], 'Fila2');

    // Elimina la fila del medio.
    await user.click(removeRowButtons()[1]);

    const remainingNames = nameInputs().map((input) => (input as HTMLInputElement).value);
    expect(remainingNames).toEqual(['Fila0', 'Fila2']);
  });

  it('una fila con nombre pero sin cantidad/unidad bloquea el envío señalando esa fila puntual', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/^Nombre de la Receta/i), 'Receta Con Fila Incompleta');
    await user.click(screen.getByRole('button', { name: 'Vegano' }));
    await user.type(screen.getByLabelText(/Tiempo de Preparación/i), '10');
    await user.type(screen.getByLabelText(/Tiempo de Cocción/i), '5');
    await user.type(screen.getByLabelText(/^Descripción Breve/i), 'Descripción breve.');
    await user.type(screen.getByLabelText(/^Calorías/i), '100');
    await user.type(screen.getByLabelText(/^Proteínas/i), '5');
    await user.type(screen.getByLabelText(/^Carbohidratos/i), '10');
    await user.type(screen.getByLabelText(/^Grasas/i), '2');
    await fillIngredientRow(user, 0, { name: 'Lechuga', quantity: '1', unit: 'unidad' });
    await user.click(screen.getByRole('button', { name: '+ Añadir fila' }));
    await user.type(screen.getByTestId('ingredient-name-1'), 'Tomate');
    await user.type(screen.getByLabelText(/Pasos de Preparación/i), 'Cortar la lechuga.');

    await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

    expect(recipeService.create).not.toHaveBeenCalled();
    expect(screen.getByTestId('error-ingredient-row-1')).toHaveTextContent(INGREDIENT_ROW_INCOMPLETE_ERROR);
    expect(screen.queryByTestId('error-ingredient-row-0')).not.toBeInTheDocument();
  });

  it('al enviar exitosamente, el payload de ingredients tiene exactamente {name, quantity, unit} en el mismo orden', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    vi.mocked(recipeService.create).mockResolvedValue(buildRecipe());
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/^Nombre de la Receta/i), 'Receta Con Dos Filas');
    await user.click(screen.getByRole('button', { name: 'Vegano' }));
    await user.type(screen.getByLabelText(/Tiempo de Preparación/i), '10');
    await user.type(screen.getByLabelText(/Tiempo de Cocción/i), '5');
    await user.type(screen.getByLabelText(/^Descripción Breve/i), 'Descripción breve.');
    await user.type(screen.getByLabelText(/^Calorías/i), '100');
    await user.type(screen.getByLabelText(/^Proteínas/i), '5');
    await user.type(screen.getByLabelText(/^Carbohidratos/i), '10');
    await user.type(screen.getByLabelText(/^Grasas/i), '2');
    await fillIngredientRow(user, 0, { name: 'Lechuga', quantity: '1', unit: 'unidad' });
    await user.click(screen.getByRole('button', { name: '+ Añadir fila' }));
    await fillIngredientRow(user, 1, { name: 'Tomate', quantity: '2', unit: 'unidad' });
    await user.type(screen.getByLabelText(/Pasos de Preparación/i), 'Mezclar todo.');

    await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

    await waitFor(() => expect(recipeService.create).toHaveBeenCalledTimes(1));
    expect(lastCreatePayload()?.ingredients).toEqual([
      { name: 'Lechuga', quantity: 1, unit: 'unidad' },
      { name: 'Tomate', quantity: 2, unit: 'unidad' },
    ]);
  });
});

// NUT-20 (tester, corrección de bug real reportado en vivo por la PO) — antes de esta
// iteración, `RecipeForm` llamaba a `useIngredients()` internamente, por lo que nunca podía
// enterarse de un ingrediente creado desde otra parte de la pantalla mientras seguía montado
// (ver `RecipeDetailPage.tsx`/`DesktopRecipeDetail`: el panel derecho de "Nueva Receta"/"Editar
// Receta" convive con el botón "Nuevo Ingrediente" de la izquierda, sin desmontarse al crear
// uno). El fix: `RecipeForm` ahora recibe `catalogIngredients: Ingredient[]` y
// `catalogStatus: 'loading' | 'empty' | 'error' | 'success'` como props OBLIGATORIAS
// controladas por la página padre, en reemplazo del `useIngredients()` interno. Cambio de
// CONTRATO de props, no aditivo: todos los tests de este archivo se adaptaron para pasar estas
// dos props nuevas (ver informe final del tester para el detalle completo de qué se tocó).
describe('RecipeForm — catalogIngredients/catalogStatus como props (NUT-20, contrato nuevo)', () => {
  // Catálogo interno DELIBERADAMENTE DISTINTO del que se pasa por props: si el componente
  // siguiera leyendo `useIngredients()` por dentro (bug real), el datalist mostraría este
  // ingrediente "del hook interno" en vez de los de la prop. Se espera ROJO hoy.
  it('ofrece como sugerencias del datalist los catalogIngredients recibidos por props, ignorando cualquier catálogo que useIngredients devuelva internamente', async () => {
    mockUseIngredients({
      ingredients: [
        {
          ...buildCatalogIngredients()[0],
          id: 'internal-hook-ingredient',
          name: 'Ingrediente Del Hook Interno (no debería aparecer)',
        },
      ],
      status: 'success',
    });
    const propIngredients = buildCatalogIngredients();
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={propIngredients}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const nameInput = screen.getByTestId('ingredient-name-0');
    const listId = nameInput.getAttribute('list');
    expect(listId).toBeTruthy();

    const datalist = document.querySelector(`datalist#${listId}`);
    expect(datalist).not.toBeNull();

    const optionValues = Array.from(datalist!.querySelectorAll('option')).map((option) =>
      option.getAttribute('value'),
    );
    expect(optionValues).toEqual(expect.arrayContaining(['Quinoa', 'Lechuga', 'Tomate']));
    expect(optionValues).not.toEqual(
      expect.arrayContaining(['Ingrediente Del Hook Interno (no debería aparecer)']),
    );
  });

  it('sigue permitiendo texto libre no listado en el nombre del ingrediente, con el catálogo recibido por props', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    vi.mocked(recipeService.create).mockResolvedValue(buildRecipe());
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Texto libre no presente en el catálogo: sigue permitido y no bloquea el envío.
    await user.type(screen.getByLabelText(/^Nombre de la Receta/i), 'Receta Con Ingrediente Libre');
    await user.click(screen.getByRole('button', { name: 'Vegano' }));
    await user.type(screen.getByLabelText(/Tiempo de Preparación/i), '10');
    await user.type(screen.getByLabelText(/Tiempo de Cocción/i), '5');
    await user.type(screen.getByLabelText(/^Descripción Breve/i), 'Descripción breve.');
    await user.type(screen.getByLabelText(/^Calorías/i), '100');
    await user.type(screen.getByLabelText(/^Proteínas/i), '5');
    await user.type(screen.getByLabelText(/^Carbohidratos/i), '10');
    await user.type(screen.getByLabelText(/^Grasas/i), '2');
    await fillIngredientRow(user, 0, { name: 'Ingrediente Que No Está En El Catálogo', quantity: '1', unit: 'unidad' });
    await user.type(screen.getByLabelText(/Pasos de Preparación/i), 'Cortar todo.');

    await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

    await waitFor(() => expect(recipeService.create).toHaveBeenCalledTimes(1));
    expect(lastCreatePayload()?.ingredients[0].name).toBe('Ingrediente Que No Está En El Catálogo');
  });
});

describe('RecipeForm — catálogo de ingredientes vacío o con error (catalogStatus por props)', () => {
  it.each(['empty', 'error'] as const)(
    'el campo de nombre sigue siendo un input de texto libre funcional cuando catalogStatus es "%s"',
    async (status) => {
      // Mantiene también sincronizado el mock del hook interno (todavía consumido por la
      // implementación actual, pre-fix) para no romper este test por una razón ajena a lo que
      // cubre: acá lo relevante es que sigue funcionando como input de texto libre, no si el
      // dato viene de la prop o del hook interno (eso ya lo cubre el describe de arriba).
      mockUseIngredients({
        ingredients: [],
        status,
        errorMessage: status === 'error' ? 'No pudimos cargar el catálogo de ingredientes. Intentá de nuevo.' : null,
      });
      const user = userEvent.setup();
      vi.mocked(recipeService.create).mockResolvedValue(buildRecipe());
      render(
        <RecipeForm
          mode="create"
          catalogIngredients={[]}
          catalogStatus={status}
          onSuccess={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      await user.type(screen.getByLabelText(/^Nombre de la Receta/i), 'Receta Sin Catálogo');
      await user.click(screen.getByRole('button', { name: 'Vegano' }));
      await user.type(screen.getByLabelText(/Tiempo de Preparación/i), '10');
      await user.type(screen.getByLabelText(/Tiempo de Cocción/i), '5');
      await user.type(screen.getByLabelText(/^Descripción Breve/i), 'Descripción breve.');
      await user.type(screen.getByLabelText(/^Calorías/i), '100');
      await user.type(screen.getByLabelText(/^Proteínas/i), '5');
      await user.type(screen.getByLabelText(/^Carbohidratos/i), '10');
      await user.type(screen.getByLabelText(/^Grasas/i), '2');
      await fillIngredientRow(user, 0, { name: 'Cualquier Cosa', quantity: '1', unit: 'unidad' });
      await user.type(screen.getByLabelText(/Pasos de Preparación/i), 'Cortar todo.');

      expect(screen.getByTestId('ingredient-name-0')).toHaveValue('Cualquier Cosa');

      await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

      await waitFor(() => expect(recipeService.create).toHaveBeenCalledTimes(1));
    },
  );
});

describe('RecipeForm — pasos de preparación, serialización', () => {
  it('descarta líneas en blanco al serializar instructions', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    vi.mocked(recipeService.create).mockResolvedValue(buildRecipe());
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/^Nombre de la Receta/i), 'Receta Con Pasos');
    await user.click(screen.getByRole('button', { name: 'Vegano' }));
    await user.type(screen.getByLabelText(/Tiempo de Preparación/i), '10');
    await user.type(screen.getByLabelText(/Tiempo de Cocción/i), '20');
    await user.type(screen.getByLabelText(/^Descripción Breve/i), 'Descripción breve.');
    await user.type(screen.getByLabelText(/^Calorías/i), '100');
    await user.type(screen.getByLabelText(/^Proteínas/i), '5');
    await user.type(screen.getByLabelText(/^Carbohidratos/i), '10');
    await user.type(screen.getByLabelText(/^Grasas/i), '2');
    await fillIngredientRow(user, 0, { name: 'Lechuga', quantity: '1', unit: 'unidad' });

    await user.type(
      screen.getByLabelText(/Pasos de Preparación/i),
      'Precalentar el horno{enter}{enter}Hornear 20 minutos{enter}',
    );

    await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

    await waitFor(() => expect(recipeService.create).toHaveBeenCalledTimes(1));
    expect(lastCreatePayload()?.instructions).toEqual(['Precalentar el horno', 'Hornear 20 minutos']);
  });
});

describe('RecipeForm — serialización de "Propiedades y Restricciones"', () => {
  it('serializa el texto separado por comas a un array recortado', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    vi.mocked(recipeService.create).mockResolvedValue(buildRecipe());
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await fillMinimalValidForm(user);
    await user.type(screen.getByLabelText(/Propiedades y Restricciones/i), 'Vegano, Sin Gluten,  Bajo en Sodio');

    await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

    await waitFor(() => expect(recipeService.create).toHaveBeenCalledTimes(1));
    expect(lastCreatePayload()?.properties).toEqual(['Vegano', 'Sin Gluten', 'Bajo en Sodio']);
  });

  it('envía properties: [] cuando el campo queda vacío', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    vi.mocked(recipeService.create).mockResolvedValue(buildRecipe());
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await fillMinimalValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

    await waitFor(() => expect(recipeService.create).toHaveBeenCalledTimes(1));
    expect(lastCreatePayload()?.properties).toEqual([]);
  });
});

describe('RecipeForm — envío exitoso en modo crear', () => {
  it('llama a recipeService.create una vez con el CreateRecipeRequest exacto e invoca onSuccess', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const created = buildRecipe({ id: 'recipe-new' });
    vi.mocked(recipeService.create).mockResolvedValue(created);
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />,
    );

    await fillMinimalValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(recipeService.create).toHaveBeenCalledTimes(1);
    expect(lastCreatePayload()).toEqual({
      title: 'Nueva Receta De Prueba',
      categories: ['VEGAN'],
      prepMinutes: 10,
      cookMinutes: 5,
      description: 'Una descripción breve de prueba.',
      nutritionalValues: { calories: 100, protein: 5, carbs: 10, fat: 2 },
      ingredients: [{ name: 'Lechuga', quantity: 1, unit: 'unidad' }],
      instructions: ['Cortar la lechuga.'],
      properties: [],
    });
    expect(onSuccess).toHaveBeenCalledWith(created);
  });
});

describe('RecipeForm — envío exitoso en modo editar', () => {
  it('llama a recipeService.update con el payload COMPLETO actual del formulario, no un delta', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    const recipe = buildRecipe();
    const onSuccess = vi.fn();
    const updated = buildRecipe({ categories: ['VEGAN', 'GLUTEN_FREE', 'OTHER'] });
    vi.mocked(recipeService.update).mockResolvedValue(updated);
    render(
      <RecipeForm
        mode="edit"
        initialValues={recipe}
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />,
    );

    // Único cambio: agrega una categoría más a las ya precargadas.
    await user.click(screen.getByRole('button', { name: 'Otra' }));

    await user.click(screen.getByRole('button', { name: 'Guardar Cambios' }));

    await waitFor(() => expect(recipeService.update).toHaveBeenCalledTimes(1));
    const call = lastUpdateCall();
    expect(call?.[0]).toBe(recipe.id);
    const payload = call?.[1] as CreateRecipeRequest;

    expect(payload.categories).toEqual(expect.arrayContaining(['VEGAN', 'GLUTEN_FREE', 'OTHER']));
    expect(payload.categories).toHaveLength(3);

    // El resto del payload va COMPLETO, no sólo el campo tocado: `properties`/`ingredients`
    // siguen siendo el array entero precargado, no vacíos ni parciales.
    expect(payload).toMatchObject({
      title: recipe.title,
      description: recipe.description,
      prepMinutes: recipe.prepMinutes,
      cookMinutes: recipe.cookMinutes,
      ingredients: recipe.ingredients,
      instructions: recipe.instructions,
      nutritionalValues: recipe.nutritionalValues,
      properties: recipe.properties,
    });

    expect(onSuccess).toHaveBeenCalledWith(updated);
  });
});

describe('RecipeForm — estado de envío en curso', () => {
  it('deshabilita el botón de envío mientras la petición está pendiente', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    const { promise, resolve } = createDeferred<Recipe>();
    vi.mocked(recipeService.create).mockReturnValue(promise);
    const onSuccess = vi.fn();
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />,
    );

    await fillMinimalValidForm(user);
    const saveButton = screen.getByRole('button', { name: 'Guardar Receta' });
    await user.click(saveButton);

    expect(saveButton).toBeDisabled();
    expect(recipeService.create).toHaveBeenCalledTimes(1);

    await user.click(saveButton);
    expect(recipeService.create).toHaveBeenCalledTimes(1);

    resolve(buildRecipe());
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });
});

describe('RecipeForm — error del backend', () => {
  it.each([
    ['validation', VALIDATION_ERROR],
    ['network', CONNECTIVITY_ERROR],
    ['timeout', CONNECTIVITY_ERROR],
    ['unexpected', UNEXPECTED_ERROR],
  ] as const)(
    'muestra el banner correspondiente para un error "%s", no cierra el formulario y conserva los datos',
    async (kind, expectedMessage) => {
      mockUseIngredients();
      const user = userEvent.setup();
      vi.mocked(recipeService.create).mockRejectedValue(new RecipeRequestError(kind));
      const onSuccess = vi.fn();
      const onCancel = vi.fn();
      render(
        <RecipeForm
          mode="create"
          catalogIngredients={buildCatalogIngredients()}
          catalogStatus="success"
          onSuccess={onSuccess}
          onCancel={onCancel}
        />,
      );

      await fillMinimalValidForm(user);
      await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

      expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
      expect(onSuccess).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/^Nombre de la Receta/i)).toHaveValue('Nueva Receta De Prueba');
    },
  );

  it('permite reintentar con el mismo botón tras un error de red', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    vi.mocked(recipeService.create)
      .mockRejectedValueOnce(new RecipeRequestError('network'))
      .mockResolvedValueOnce(buildRecipe());
    const onSuccess = vi.fn();
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />,
    );

    await fillMinimalValidForm(user);
    const saveButton = screen.getByRole('button', { name: 'Guardar Receta' });
    await user.click(saveButton);

    expect(await screen.findByText(CONNECTIVITY_ERROR)).toBeInTheDocument();

    await user.click(saveButton);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(recipeService.create).toHaveBeenCalledTimes(2);
  });
});

// NUT-20 (séptima iteración, tester) — Hallazgo 2 (bloqueante) del cuarto review: mientras el
// formulario está enviando (`submitting`), el botón "Cancelar" NO se deshabilita hoy, y no
// existe forma de que el `Modal` padre sepa que hay un envío en curso para volverse no
// cerrable. La corrección: (b) deshabilitar también "Cancelar" mientras `submitting` es
// `true`; (c) exponer un callback opcional `onSubmittingChange?: (submitting: boolean) => void`
// invocado al arrancar y al terminar el envío (éxito o error). Se espera ROJO hoy en las tres
// pruebas de este bloque: el botón sigue habilitado y `onSubmittingChange` todavía no existe
// como prop consumida por el componente.
describe('RecipeForm — cancelar deshabilitado durante envío y onSubmittingChange (Hallazgo 2, cuarto review)', () => {
  it('deshabilita el botón "Cancelar" mientras la petición está pendiente', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    const { promise, resolve } = createDeferred<Recipe>();
    vi.mocked(recipeService.create).mockReturnValue(promise);
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await fillMinimalValidForm(user);
    const cancelButton = screen.getByRole('button', { name: 'Cancelar' });
    expect(cancelButton).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

    expect(cancelButton).toBeDisabled();

    resolve(buildRecipe());
    await waitFor(() => expect(cancelButton).toBeEnabled());
  });

  it('invoca onSubmittingChange(true) al arrancar el envío y onSubmittingChange(false) al resolver con éxito', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    const { promise, resolve } = createDeferred<Recipe>();
    vi.mocked(recipeService.create).mockReturnValue(promise);
    const onSubmittingChange = vi.fn();
    const onSuccess = vi.fn();
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={onSuccess}
        onCancel={vi.fn()}
        onSubmittingChange={onSubmittingChange}
      />,
    );

    await fillMinimalValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

    expect(onSubmittingChange).toHaveBeenNthCalledWith(1, true);

    resolve(buildRecipe());
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    expect(onSubmittingChange).toHaveBeenLastCalledWith(false);
  });

  it('invoca onSubmittingChange(false) también cuando el envío termina en error', async () => {
    mockUseIngredients();
    const user = userEvent.setup();
    vi.mocked(recipeService.create).mockRejectedValue(new RecipeRequestError('network'));
    const onSubmittingChange = vi.fn();
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        onSubmittingChange={onSubmittingChange}
      />,
    );

    await fillMinimalValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Receta' }));

    expect(await screen.findByText(CONNECTIVITY_ERROR)).toBeInTheDocument();
    expect(onSubmittingChange).toHaveBeenNthCalledWith(1, true);
    expect(onSubmittingChange).toHaveBeenLastCalledWith(false);
  });
});

describe('RecipeForm — cancelar', () => {
  it.each(['create', 'edit'] as const)(
    'invoca onCancel sin llamar a ningún método del servicio en modo "%s"',
    async (mode) => {
      mockUseIngredients();
      const user = userEvent.setup();
      const onCancel = vi.fn();
      const recipe = mode === 'edit' ? buildRecipe() : undefined;

      render(
        <RecipeForm
          mode={mode}
          initialValues={recipe}
          catalogIngredients={buildCatalogIngredients()}
          catalogStatus="success"
          onSuccess={vi.fn()}
          onCancel={onCancel}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Cancelar' }));

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(recipeService.create).not.toHaveBeenCalled();
      expect(recipeService.update).not.toHaveBeenCalled();
    },
  );
});

// NUT-20 (undécima iteración, tester) — mismo pedido directo de la PO que en
// `IngredientForm.test.tsx`: cada etiqueta de campo numérico de nutrición debe mostrar la
// unidad entre paréntesis junto al nombre del campo. Se espera ROJO hoy: el componente
// todavía muestra sólo "Calorías *", "Proteínas *", etc., sin la unidad.
//
// Esto NO debería romper ninguno de los `getByLabelText` usados en el resto de este archivo
// (p. ej. `/^Calorías/i`, `/^Proteínas/i`, `/^Carbohidratos/i`, `/^Grasas/i`): todas esas regex
// anclan únicamente el INICIO del texto de la etiqueta (`^`) y no exigen que termine ahí, así
// que agregar "(kcal)"/"(g)" después del nombre del campo sigue matcheando sin cambios.
describe('RecipeForm — unidades visibles en las etiquetas de nutrición (pedido directo de la PO)', () => {
  it('muestra la unidad entre paréntesis junto a cada etiqueta numérica de nutrición', () => {
    mockUseIngredients();
    render(
      <RecipeForm
        mode="create"
        catalogIngredients={buildCatalogIngredients()}
        catalogStatus="success"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/Calorías \(kcal\)/)).toBeInTheDocument();
    expect(screen.getByText(/Proteínas \(g\)/)).toBeInTheDocument();
    expect(screen.getByText(/Carbohidratos \(g\)/)).toBeInTheDocument();
    expect(screen.getByText(/Grasas \(g\)/)).toBeInTheDocument();
  });
});
