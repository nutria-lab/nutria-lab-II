import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RecipeCatalogList } from './RecipeCatalogList';
import type { Recipe } from '../../../services/recipeService';

// NUT-20 (octava iteración, tester) — adaptación tablet/desktop (design.md sección 9.2).
// `RecipeCatalogList` todavía NO EXISTE: extrae la lógica de listado/buscador/chips/tarjetas
// que hoy vive íntegramente dentro de `RecipesListPage.tsx`, para que tanto `RecipesListPage`
// (mobile) como `RecipeDetailPage` (columna izquierda en escritorio) la reutilicen sin duplicar
// JSX. Se espera ROJO hoy por módulo inexistente.
//
// --- API propia del tester para este componente (documentada también en el informe final) ----
// type RecipeCatalogListProps = {
//   recipes: Recipe[];
//   status: 'loading' | 'empty' | 'error' | 'success';
//   errorMessage: string | null;
//   onRetry: () => void;
//   selectedId?: string | null;
//   onSelectRecipe: (id: string) => void;
//   onCreateRecipe: () => void;
//   onCreateIngredient: () => void;
// };
// El componente NO usa `useNavigate`/router: es agnóstico de navegación a propósito (deja esa
// decisión a quien lo use — `RecipesListPage` navega, `RecipeDetailPage` cambia de ruta y/o
// estado local), y por eso este test lo monta SIN ningún `MemoryRouter`. Mantiene el mismo
// buscador/chips/tarjetas/estados que ya tenía `RecipesListPage` (mismos testids y textos:
// `recipes-loading-skeleton`, `recipe-card-<id>`, "Todas (N)", "+ Ingrediente", "Todavía no
// tenés recetas", "Algo salió mal"/"Reintentar", "No encontramos recetas que coincidan con tu
// búsqueda."). Búsqueda y filtro de categoría son estado INTERNO del componente (igual que hoy
// en `RecipesListPage`), no props controladas. La fila "seleccionada" (prop `selectedId`,
// usada por `RecipeDetailPage` en escritorio para resaltar la receta actualmente mostrada en el
// panel derecho) se marca con `aria-current="true"` en su tarjeta — criterio propio del tester.

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

// Más de una categoría a la vez + `nutritionalValues: null` (dato histórico), mismo criterio
// ya usado por `RecipesListPage.test.tsx`.
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

// Fixture del backend real pre-NUT-61 (Hallazgo 1, cuarto review, ya cubierto para
// `RecipesListPage` — se reproduce acá porque el componente extraído hereda esa misma
// responsabilidad de guarda defensiva): `categories`/`nutritionalValues`/`properties`
// directamente ausentes (`undefined`, no `[]`/`null`).
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

function cardFor(recipe: Recipe) {
  return screen.getByTestId(`recipe-card-${recipe.id}`);
}

function renderCatalogList(overrides: Partial<ComponentProps<typeof RecipeCatalogList>> = {}) {
  const props: ComponentProps<typeof RecipeCatalogList> = {
    recipes: ALL_RECIPES,
    status: 'success',
    errorMessage: null,
    onRetry: vi.fn(),
    onSelectRecipe: vi.fn(),
    onCreateRecipe: vi.fn(),
    onCreateIngredient: vi.fn(),
    ...overrides,
  };
  return { ...render(<RecipeCatalogList {...props} />), props };
}

describe('RecipeCatalogList', () => {
  it('shows a loading skeleton and no cards while status is "loading"', () => {
    renderCatalogList({ status: 'loading' });

    expect(screen.getByTestId('recipes-loading-skeleton')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText(VEGAN_RECIPE.title)).not.toBeInTheDocument();
  });

  it('shows the real empty state (never had recipes) with a call to action that calls onCreateRecipe', async () => {
    const onCreateRecipe = vi.fn();
    const user = userEvent.setup();
    renderCatalogList({ recipes: [], status: 'empty', onCreateRecipe });

    expect(screen.getByText(/todavía no tenés recetas/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /crear receta/i }));

    expect(onCreateRecipe).toHaveBeenCalledTimes(1);
  });

  it('shows an error message with a retry button that calls onRetry when there are no recipes at all', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    renderCatalogList({
      recipes: [],
      status: 'error',
      errorMessage: 'No pudimos cargar tus recetas. Intentá de nuevo.',
      onRetry,
    });

    expect(screen.getByText('No pudimos cargar tus recetas. Intentá de nuevo.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps showing the already-loaded recipes together with an error banner instead of replacing them', () => {
    renderCatalogList({
      recipes: ALL_RECIPES,
      status: 'error',
      errorMessage: 'No pudimos actualizar. Intentá de nuevo.',
    });

    expect(screen.getByText(VEGAN_RECIPE.title)).toBeInTheDocument();
    expect(screen.getByText('No pudimos actualizar. Intentá de nuevo.')).toBeInTheDocument();
  });

  it('renders all recipe cards with badge, title, description, total time and calories on success', () => {
    renderCatalogList();

    expect(screen.getByText(VEGAN_RECIPE.title)).toBeInTheDocument();
    expect(screen.getByText(VEGETARIAN_RECIPE.title)).toBeInTheDocument();
    expect(screen.getByText(HIGH_PROTEIN_GF_RECIPE.title)).toBeInTheDocument();

    expect(within(cardFor(VEGAN_RECIPE)).getByText('10 min')).toBeInTheDocument();
    expect(within(cardFor(VEGAN_RECIPE)).getByText('VEGAN')).toBeInTheDocument();
    expect(within(cardFor(VEGAN_RECIPE)).getByText('180 kcal')).toBeInTheDocument();

    // `nutritionalValues: null` (dato histórico): no rompe, sólo omite las calorías.
    expect(within(cardFor(HIGH_PROTEIN_GF_RECIPE)).queryByText(/kcal/)).not.toBeInTheDocument();
  });

  it('renders a filter chip per distinct category plus "Todas (N)", without duplicates', () => {
    renderCatalogList();

    expect(screen.getByRole('button', { name: 'Todas (3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'VEGAN' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'HIGH_PROTEIN' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'VEGAN' })).toHaveLength(1);
  });

  it('filters by category, and a recipe with more than one category shows up under each of them', async () => {
    const user = userEvent.setup();
    renderCatalogList();

    await user.click(screen.getByRole('button', { name: 'HIGH_PROTEIN' }));

    expect(screen.getByText(HIGH_PROTEIN_GF_RECIPE.title)).toBeInTheDocument();
    expect(screen.queryByText(VEGAN_RECIPE.title)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'GLUTEN_FREE' }));

    expect(screen.getByText(HIGH_PROTEIN_GF_RECIPE.title)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Todas (3)' }));

    expect(screen.getByText(VEGAN_RECIPE.title)).toBeInTheDocument();
    expect(screen.getByText(VEGETARIAN_RECIPE.title)).toBeInTheDocument();
  });

  it('filters by name search, case-insensitively, and shows a distinct "no results" message when nothing matches', async () => {
    const user = userEvent.setup();
    renderCatalogList();

    const searchInput = screen.getByRole('textbox', { name: /buscar/i });
    await user.type(searchInput, 'TARTA');

    expect(screen.getByText(VEGETARIAN_RECIPE.title)).toBeInTheDocument();
    expect(screen.queryByText(VEGAN_RECIPE.title)).not.toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, 'inexistente-xyz');

    expect(screen.getByText(/no encontramos recetas/i)).toBeInTheDocument();
    expect(screen.queryByText(/todavía no tenés recetas/i)).not.toBeInTheDocument();
  });

  it('calls onCreateIngredient when the "+ Ingrediente" pill is clicked', async () => {
    const onCreateIngredient = vi.fn();
    const user = userEvent.setup();
    renderCatalogList({ onCreateIngredient });

    await user.click(screen.getByRole('button', { name: '+ Ingrediente' }));

    expect(onCreateIngredient).toHaveBeenCalledTimes(1);
  });

  it('calls onSelectRecipe(id) when a card is clicked', async () => {
    const onSelectRecipe = vi.fn();
    const user = userEvent.setup();
    renderCatalogList({ onSelectRecipe });

    await user.click(cardFor(VEGAN_RECIPE));

    expect(onSelectRecipe).toHaveBeenCalledWith(VEGAN_RECIPE.id);
  });

  it('marks the card matching selectedId as the current one; no card is marked when selectedId is absent', () => {
    const { rerender } = renderCatalogList();

    expect(cardFor(VEGAN_RECIPE)).not.toHaveAttribute('aria-current', 'true');
    expect(cardFor(VEGETARIAN_RECIPE)).not.toHaveAttribute('aria-current', 'true');

    rerender(
      <RecipeCatalogList
        recipes={ALL_RECIPES}
        status="success"
        errorMessage={null}
        onRetry={vi.fn()}
        onSelectRecipe={vi.fn()}
        onCreateRecipe={vi.fn()}
        onCreateIngredient={vi.fn()}
        selectedId={VEGAN_RECIPE.id}
      />,
    );

    expect(cardFor(VEGAN_RECIPE)).toHaveAttribute('aria-current', 'true');
    expect(cardFor(VEGETARIAN_RECIPE)).not.toHaveAttribute('aria-current', 'true');
  });

  describe('RecipeCatalogList — backend real pre-NUT-61 sin categories/nutritionalValues/properties', () => {
    it('renders that recipe without throwing, without an "undefined" category badge, and without inventing nutritional data', () => {
      expect(() => renderCatalogList({ recipes: [LEGACY_PRE_NUT61_RECIPE] })).not.toThrow();

      expect(screen.getByText(LEGACY_PRE_NUT61_RECIPE.title)).toBeInTheDocument();
      expect(screen.queryByText('undefined')).not.toBeInTheDocument();
      expect(screen.queryByText(/kcal/)).not.toBeInTheDocument();
    });

    it('does not generate an "undefined" filter chip when some recipe has no categories', () => {
      expect(() =>
        renderCatalogList({ recipes: [VEGAN_RECIPE, LEGACY_PRE_NUT61_RECIPE] }),
      ).not.toThrow();

      expect(screen.queryByRole('button', { name: 'undefined' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'VEGAN' })).toBeInTheDocument();
    });
  });
});
