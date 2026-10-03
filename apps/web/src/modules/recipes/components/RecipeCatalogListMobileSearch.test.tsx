import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Recipe } from '../../../services/recipeService';
import type { UseRecipeSearchResult } from '../hooks/useRecipeSearch';
import { RecipeCatalogList } from './RecipeCatalogList';

function buildMockRecipe(id: string, title: string = `Receta ${id}`): Recipe {
  return {
    id,
    title,
    description: `Descripción de ${title}`,
    categories: ['VEGAN'],
    prepMinutes: 15,
    cookMinutes: 10,
    ingredients: [{ name: 'Quinoa', quantity: 100, unit: 'g' }],
    instructions: ['Cocinar'],
    nutritionalValues: { calories: 350, protein: 12, carbs: 45, fat: 8 },
    properties: ['Sin Gluten', 'Alto en Proteína'],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function buildMockSearchResult(overrides: Partial<UseRecipeSearchResult> = {}): UseRecipeSearchResult {
  return {
    draftText: '',
    committedQuery: undefined,
    properties: [],
    maxPrepMinutes: undefined,
    page: 1,
    pageSize: 12,
    recipes: [buildMockRecipe('r1', 'Ensalada Fresca'), buildMockRecipe('r2', 'Bowl de Quinoa')],
    total: 2,
    status: 'success',
    isFetchingMore: false,
    hasMore: false,
    errorMessage: null,
    errorKind: null,
    setDraftText: vi.fn(),
    toggleProperty: vi.fn(),
    setMaxPrepMinutes: vi.fn(),
    clearFilters: vi.fn(),
    loadMore: vi.fn(),
    retry: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

describe('RecipeCatalogList - Mobile Search Mode (NUT-66)', () => {
  it('renders search bar with accessible label and calls setDraftText on input', async () => {
    const user = userEvent.setup();
    const setDraftText = vi.fn();
    const search = buildMockSearchResult({ draftText: 'quin', setDraftText });

    render(
      <RecipeCatalogList
        onSelectRecipe={vi.fn()}
        onCreateRecipe={vi.fn()}
        search={search}
      />,
    );

    const input = screen.getByPlaceholderText(/buscar por nombre o ingrediente/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('quin');

    // Clear button is visible when draftText is non-empty
    const clearBtn = screen.getByRole('button', { name: /limpiar búsqueda/i });
    expect(clearBtn).toBeInTheDocument();

    await user.click(clearBtn);
    expect(setDraftText).toHaveBeenCalledWith('');
  });

  it('renders multi-select property chips with aria-pressed and keyboard operability', async () => {
    const user = userEvent.setup();
    const toggleProperty = vi.fn();
    const search = buildMockSearchResult({
      properties: ['Sin Gluten'],
      toggleProperty,
    });

    render(
      <RecipeCatalogList
        onSelectRecipe={vi.fn()}
        onCreateRecipe={vi.fn()}
        search={search}
      />,
    );

    const chipsContainer = screen.getByTestId('recipe-property-chips');
    expect(chipsContainer).toBeInTheDocument();

    // "Todas" chip should have aria-pressed="false" because 'Sin Gluten' is selected
    const todasChip = within(chipsContainer).getByRole('button', { name: /todas/i });
    expect(todasChip).toHaveAttribute('aria-pressed', 'false');

    // 'Sin Gluten' chip should have aria-pressed="true"
    const sinGlutenChip = within(chipsContainer).getByRole('button', { name: 'Sin Gluten' });
    expect(sinGlutenChip).toHaveAttribute('aria-pressed', 'true');

    // Click another property chip
    const altoEnProteinaChip = within(chipsContainer).getByRole('button', { name: 'Alto en Proteína' });
    expect(altoEnProteinaChip).toHaveAttribute('aria-pressed', 'false');

    await user.click(altoEnProteinaChip);
    expect(toggleProperty).toHaveBeenCalledWith('Alto en Proteína');
  });

  it('opens time filter sheet and selects max prep time', async () => {
    const user = userEvent.setup();
    const setMaxPrepMinutes = vi.fn();
    const search = buildMockSearchResult({
      maxPrepMinutes: undefined,
      setMaxPrepMinutes,
    });

    render(
      <RecipeCatalogList
        onSelectRecipe={vi.fn()}
        onCreateRecipe={vi.fn()}
        search={search}
      />,
    );

    const timeBtn = screen.getByRole('button', { name: /filtrar por tiempo de preparación/i });
    expect(timeBtn).toBeInTheDocument();

    await user.click(timeBtn);

    // Bottom sheet dialog opens
    const dialog = screen.getByRole('dialog', { name: /tiempo de preparación/i });
    expect(dialog).toBeInTheDocument();

    // Choose 30 min
    const option30 = screen.getByRole('radio', { name: /hasta 30 minutos/i });
    await user.click(option30);

    expect(setMaxPrepMinutes).toHaveBeenCalledWith(30);
  });

  it('renders incremental pagination button when hasMore is true and maintains accessible focus', async () => {
    const user = userEvent.setup();
    const loadMore = vi.fn();
    const search = buildMockSearchResult({
      hasMore: true,
      isFetchingMore: false,
      loadMore,
      total: 15,
    });

    render(
      <RecipeCatalogList
        onSelectRecipe={vi.fn()}
        onCreateRecipe={vi.fn()}
        search={search}
      />,
    );

    const loadMoreBtn = screen.getByRole('button', { name: /cargar más recetas/i });
    expect(loadMoreBtn).toBeInTheDocument();

    await user.click(loadMoreBtn);
    expect(loadMore).toHaveBeenCalled();
    expect(loadMoreBtn).toHaveFocus();
  });

  it('shows loading spinner inside pagination button while isFetchingMore is true', () => {
    const search = buildMockSearchResult({
      hasMore: true,
      isFetchingMore: true,
    });

    render(
      <RecipeCatalogList
        onSelectRecipe={vi.fn()}
        onCreateRecipe={vi.fn()}
        search={search}
      />,
    );

    expect(screen.getByText(/cargando más recetas.../i)).toBeInTheDocument();
  });

  it('announces results count with aria-live="polite"', () => {
    const search = buildMockSearchResult({ total: 5 });

    render(
      <RecipeCatalogList
        onSelectRecipe={vi.fn()}
        onCreateRecipe={vi.fn()}
        search={search}
      />,
    );

    const countElement = screen.getByText(/5 recetas disponibles/i);
    expect(countElement).toHaveAttribute('aria-live', 'polite');
  });

  it('renders empty state with "Limpiar filtros" action button', async () => {
    const user = userEvent.setup();
    const clearFilters = vi.fn();
    const search = buildMockSearchResult({
      draftText: 'quinoa',
      recipes: [],
      total: 0,
      status: 'empty',
      clearFilters,
    });

    render(
      <RecipeCatalogList
        onSelectRecipe={vi.fn()}
        onCreateRecipe={vi.fn()}
        search={search}
      />,
    );

    expect(screen.getByText(/no se encontraron recetas/i)).toBeInTheDocument();
    const clearBtn = screen.getByRole('button', { name: /limpiar filtros/i });
    expect(clearBtn).toBeInTheDocument();

    await user.click(clearBtn);
    expect(clearFilters).toHaveBeenCalled();
  });

  it('renders error state with actionable message and retry button', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const search = buildMockSearchResult({
      recipes: [],
      status: 'error',
      errorMessage: 'Los parámetros de búsqueda son inválidos. Verificá los filtros.',
      errorKind: 'validation',
      retry,
    });

    render(
      <RecipeCatalogList
        onSelectRecipe={vi.fn()}
        onCreateRecipe={vi.fn()}
        search={search}
      />,
    );

    expect(screen.getAllByText(/los parámetros de búsqueda son inválidos/i).length).toBeGreaterThan(0);
    const retryBtn = screen.getByRole('button', { name: /reintentar/i });
    await user.click(retryBtn);
    expect(retry).toHaveBeenCalled();
  });

  it('calls onSelectRecipe when a recipe card is clicked', async () => {
    const user = userEvent.setup();
    const onSelectRecipe = vi.fn();
    const search = buildMockSearchResult();

    render(
      <RecipeCatalogList
        onSelectRecipe={onSelectRecipe}
        onCreateRecipe={vi.fn()}
        search={search}
      />,
    );

    const card = screen.getByTestId('recipe-card-r1');
    await user.click(card);

    expect(onSelectRecipe).toHaveBeenCalledWith('r1');
  });
});
