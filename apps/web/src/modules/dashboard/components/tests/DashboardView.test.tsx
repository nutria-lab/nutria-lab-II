import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAdherenceWidgetProps } from '@/modules/dashboard/adherence-widget/fixtures';
import type { AdherenceWidgetProps } from '@/modules/dashboard/adherence-widget/types';
import { DashboardView } from '@/modules/dashboard/components/DashboardView';
import {
  DASHBOARD_FIXTURES,
  adherenceResponseFixture,
  selectDashboardFixture,
  type DashboardFixtureKey,
} from '@/modules/dashboard/fixtures';
import type {
  CardState,
  DashboardViewModel,
  MealCompletionStatus,
  TodayMeal,
  TodayMealsData,
} from '@/modules/dashboard/types';
import { nextMealToLog } from '@/modules/dashboard/utils';
import { MEAL_TYPE_LABELS } from '@/modules/meal-plan/utils';

afterEach(cleanup);

const FIXTURE_KEYS = Object.keys(DASHBOARD_FIXTURES) as DashboardFixtureKey[];

const NEXT_MEAL_TITLE = 'Siguiente comida por registrar';
const ALL_LOGGED = 'Ya registraste todas las comidas de hoy.';
const MEALS_ERROR = 'No pudimos cargar tus comidas de hoy.';
const PROGRESS_ERROR = 'No pudimos cargar tu progreso.';
const PARTIAL_NOTE = 'El estado de registro no está disponible por ahora.';
const UNAVAILABLE = 'No disponible todavía';
const STATUS_CHIPS = ['Sin registrar', 'Completada', 'Omitida'];
const EXCLUDED_COPY = /premium|racha|logro|notificaci|hidrat|consejo/i;

function meal(overrides: Partial<TodayMeal> & Pick<TodayMeal, 'plannedMealId' | 'mealType'>): TodayMeal {
  return {
    title: `Receta de prueba ${overrides.plannedMealId}`,
    recipeId: `recipe-${overrides.plannedMealId}`,
    status: 'NOT_LOGGED',
    ...overrides,
  };
}

function readyMeals(meals: TodayMeal[]): CardState<TodayMealsData> {
  return { kind: 'ready', data: { kind: 'meals', meals } };
}

function readyAdherence(overrides: Partial<AdherenceWidgetProps> = {}): AdherenceWidgetProps {
  return { data: adherenceResponseFixture, loading: false, error: null, onRetry: vi.fn(), ...overrides };
}

function viewModel(overrides: Partial<DashboardViewModel> = {}): DashboardViewModel {
  return {
    userName: 'María José',
    todayMeals: readyMeals([]),
    adherence: readyAdherence(),
    shopping: { kind: 'unavailable' },
    ...overrides,
  };
}

function renderView(model: DashboardViewModel) {
  const { container } = render(
    <MemoryRouter>
      <DashboardView viewModel={model} />
    </MemoryRouter>,
  );
  return { container, view: within(container) };
}

function renderFixture(key: DashboardFixtureKey, userName: string | null = 'María José', onRetry = vi.fn()) {
  const model = selectDashboardFixture(key, userName, onRetry);
  if (!model) throw new Error(`Fixture ${key} not found`);
  return renderView(model);
}

function fixtureMeals(key: DashboardFixtureKey): TodayMeal[] {
  const state = selectDashboardFixture(key, null, vi.fn())?.todayMeals;
  if (!state) throw new Error(`Fixture ${key} not found`);
  if (state.kind !== 'ready' || state.data.kind !== 'meals') {
    throw new Error(`El fixture ${key} no tiene comidas`);
  }
  return state.data.meals;
}

function todayMealsList(view: ReturnType<typeof within>) {
  const region = view.getByRole('region', { name: 'Comidas de hoy' });
  return within(region).getByRole('list');
}

// Comidas desordenadas: DINNER, SNACK, BREAKFAST, LUNCH.
const UNORDERED_MEALS: TodayMeal[] = [
  meal({ plannedMealId: 'dinner', mealType: 'DINNER', status: 'NOT_LOGGED' }),
  meal({ plannedMealId: 'snack', mealType: 'SNACK', status: 'SKIPPED' }),
  meal({ plannedMealId: 'breakfast', mealType: 'BREAKFAST', status: 'COMPLETED' }),
  meal({ plannedMealId: 'lunch', mealType: 'LUNCH', status: 'NOT_LOGGED' }),
];

describe('DashboardView greeting', () => {
  it('renders "Hola, {first name}" as the single level-1 heading', () => {
    const { view } = renderView(viewModel({ userName: 'María José' }));

    expect(view.getByRole('heading', { level: 1, name: 'Hola, María' })).toBeInTheDocument();
    expect(view.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(view.getByText('Hoy es un buen día para nutrirte.')).toBeInTheDocument();
  });

  it('lets a long greeting wrap instead of overflowing (break-words)', () => {
    const { view } = renderView(viewModel({ userName: 'Maximilianaconstanzaguadalupeesperanza' }));

    expect(view.getByRole('heading', { level: 1 })).toHaveClass('break-words');
  });

  it('renders "Hola" without comma when there is no name', () => {
    const { view } = renderView(viewModel({ userName: null }));

    expect(view.getByRole('heading', { level: 1, name: 'Hola' })).toBeInTheDocument();
  });

  it('renders "Hola" for the sin-nombre fixture', () => {
    const { view } = renderFixture('sin-nombre');

    expect(view.getByRole('heading', { level: 1, name: 'Hola' })).toBeInTheDocument();
  });

  it.each(FIXTURE_KEYS)('keeps exactly one level-1 heading in the %s fixture (brand is not a heading)', (key) => {
    const { view } = renderFixture(key);

    expect(view.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(view.queryByRole('heading', { name: 'NutrIA' })).not.toBeInTheDocument();
  });
});

describe('DashboardView today meals list', () => {
  it('lists meals in BREAKFAST, LUNCH, SNACK, DINNER order with type labels and status chips', () => {
    const { view } = renderView(viewModel({ todayMeals: readyMeals(UNORDERED_MEALS) }));

    const items = within(todayMealsList(view)).getAllByRole('listitem');
    expect(items).toHaveLength(4);

    const expected = [
      ['Desayuno', 'Completada', 'Receta de prueba breakfast'],
      ['Almuerzo', 'Sin registrar', 'Receta de prueba lunch'],
      ['Merienda', 'Omitida', 'Receta de prueba snack'],
      ['Cena', 'Sin registrar', 'Receta de prueba dinner'],
    ];
    items.forEach((item, index) => {
      const [label, chip, title] = expected[index]!;
      expect(within(item).getByText(label!)).toBeInTheDocument();
      expect(within(item).getByText(chip!)).toBeInTheDocument();
      expect(within(item).getByText(title!)).toBeInTheDocument();
    });
  });

  it('uses an explicit single-column track below md so a long title cannot widen it', () => {
    const longTitle = `Ensalada ${'muy larga de quinoa con vegetales asados y aderezo '.repeat(3)}`.trim();
    expect(longTitle.length).toBeGreaterThanOrEqual(120);
    const meals = [meal({ plannedMealId: 'lunch', mealType: 'LUNCH', title: longTitle })];
    const { view } = renderView(viewModel({ todayMeals: readyMeals(meals) }));

    const list = todayMealsList(view);
    expect(within(list).getByText(longTitle)).toBeInTheDocument();
    expect(list).toHaveClass('grid', 'grid-cols-1');
  });

  it('renders the comidas fixture sorted with one chip per meal', () => {
    const { view } = renderFixture('comidas');
    const meals = fixtureMeals('comidas');
    const order = ['BREAKFAST', 'LUNCH', 'SNACK', 'DINNER'] as const;
    const expectedLabels = [...meals]
      .sort((a, b) => order.indexOf(a.mealType) - order.indexOf(b.mealType))
      .map((m) => MEAL_TYPE_LABELS[m.mealType]);

    const items = within(todayMealsList(view)).getAllByRole('listitem');
    expect(items).toHaveLength(meals.length);
    items.forEach((item, index) => {
      expect(within(item).getByText(expectedLabels[index]!)).toBeInTheDocument();
      const chips = STATUS_CHIPS.filter((chip) => within(item).queryByText(chip) !== null);
      expect(chips).toHaveLength(1);
    });
  });
});

describe('DashboardView next meal highlight', () => {
  it('highlights the first NOT_LOGGED meal in fixed order with a "Ver receta" link', () => {
    const { view } = renderView(viewModel({ todayMeals: readyMeals(UNORDERED_MEALS) }));

    const highlight = view.getByRole('region', { name: NEXT_MEAL_TITLE });
    expect(within(highlight).getByText('Receta de prueba lunch')).toBeInTheDocument();
    expect(within(highlight).getByText('Almuerzo')).toBeInTheDocument();
    expect(within(highlight).queryByText('Receta de prueba dinner')).not.toBeInTheDocument();
    expect(within(highlight).getByRole('link', { name: 'Ver receta' })).toHaveAttribute(
      'href',
      '/recipes/recipe-lunch',
    );
  });

  it('does not render "Ver receta" when the highlighted meal has no recipeId', () => {
    const meals = [
      meal({ plannedMealId: 'lunch', mealType: 'LUNCH', status: 'NOT_LOGGED', recipeId: null }),
      meal({ plannedMealId: 'dinner', mealType: 'DINNER', status: 'NOT_LOGGED' }),
    ];
    const { view } = renderView(viewModel({ todayMeals: readyMeals(meals) }));

    const highlight = view.getByRole('region', { name: NEXT_MEAL_TITLE });
    expect(within(highlight).getByText('Receta de prueba lunch')).toBeInTheDocument();
    expect(view.queryByRole('link', { name: 'Ver receta' })).not.toBeInTheDocument();
  });

  it('highlights the first pending meal of the comidas fixture', () => {
    const { view } = renderFixture('comidas');
    const next = nextMealToLog(fixtureMeals('comidas'));
    if (!next) throw new Error('El fixture comidas debe tener una comida pendiente');

    const highlight = view.getByRole('region', { name: NEXT_MEAL_TITLE });
    expect(within(highlight).getByText(next.title)).toBeInTheDocument();
    const link = within(highlight).queryByRole('link', { name: 'Ver receta' });
    if (next.recipeId) {
      expect(link).toHaveAttribute('href', `/recipes/${next.recipeId}`);
    } else {
      expect(link).not.toBeInTheDocument();
    }
  });

  it('shows the all-logged message and no highlight when nothing is pending', () => {
    const { view } = renderFixture('todo-registrado');

    expect(view.getByText(ALL_LOGGED)).toBeInTheDocument();
    expect(view.queryByText(NEXT_MEAL_TITLE)).not.toBeInTheDocument();
    expect(view.queryByRole('link', { name: 'Ver receta' })).not.toBeInTheDocument();
    expect(view.queryByText(/comiste|consumid/i)).not.toBeInTheDocument();
    expect(within(todayMealsList(view)).getAllByRole('listitem').length).toBeGreaterThan(0);
  });
});

describe('DashboardView card states', () => {
  it('no plan: explains and links to /meal-plan, without highlight', () => {
    const { view } = renderFixture('sin-plan');

    const mealsCard = view.getByRole('region', { name: 'Comidas de hoy' });
    expect(within(mealsCard).getByText('Todavía no tenés un plan para esta semana.')).toBeInTheDocument();
    // El progreso usa el mismo texto aprobado para el mismo estado.
    expect(
      within(view.getByRole('region', { name: 'Progreso de la semana' })).getByText('Todavía no tenés un plan para esta semana.'),
    ).toBeInTheDocument();
    expect(view.getByRole('link', { name: 'Ir a mi plan' })).toHaveAttribute('href', '/meal-plan');
    expect(view.queryByText(NEXT_MEAL_TITLE)).not.toBeInTheDocument();
  });

  it('no meals today: explains and links to /meal-plan, without highlight', () => {
    const { view } = renderFixture('sin-comidas');

    expect(view.getByText('No hay comidas planificadas para hoy.')).toBeInTheDocument();
    expect(view.getByRole('link', { name: 'Ver plan semanal' })).toHaveAttribute('href', '/meal-plan');
    expect(view.queryByText(NEXT_MEAL_TITLE)).not.toBeInTheDocument();
  });

  it('loading: renders an aria-busy skeleton without highlight', () => {
    const { container, view } = renderFixture('loading');

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(view.queryByText(NEXT_MEAL_TITLE)).not.toBeInTheDocument();
  });

  it('loading: every skeleton carries visually hidden "Cargando…" text for screen readers', () => {
    const { container, view } = renderFixture('loading');

    const skeletons = Array.from(container.querySelectorAll<HTMLElement>('[aria-busy="true"]'));
    expect(skeletons.length).toBeGreaterThan(0);
    expect(view.getAllByText('Cargando…')).toHaveLength(skeletons.length);
    for (const skeleton of skeletons) {
      expect(within(skeleton).getByText('Cargando…')).toHaveClass('sr-only');
    }
  });

  it('empty meals array: shows the no-meals-today state, without empty list nor highlight', () => {
    const { view } = renderView(viewModel({ todayMeals: { kind: 'ready', data: { kind: 'meals', meals: [] } } }));

    const region = view.getByRole('region', { name: 'Comidas de hoy' });
    expect(within(region).getByText('No hay comidas planificadas para hoy.')).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'Ver plan semanal' })).toHaveAttribute('href', '/meal-plan');
    expect(within(region).queryByRole('list')).not.toBeInTheDocument();
    expect(view.queryByText(NEXT_MEAL_TITLE)).not.toBeInTheDocument();
    expect(view.queryByText(ALL_LOGGED)).not.toBeInTheDocument();
  });

  it('mixed null and known statuses: no highlight, no chips and the unavailable-status note', () => {
    const meals = [
      meal({ plannedMealId: 'breakfast', mealType: 'BREAKFAST', status: null }),
      meal({ plannedMealId: 'lunch', mealType: 'LUNCH', status: 'NOT_LOGGED' }),
      meal({ plannedMealId: 'dinner', mealType: 'DINNER', status: 'COMPLETED' }),
    ];
    const { view } = renderView(viewModel({ todayMeals: readyMeals(meals) }));

    expect(within(todayMealsList(view)).getAllByRole('listitem')).toHaveLength(3);
    expect(view.queryByText(NEXT_MEAL_TITLE)).not.toBeInTheDocument();
    expect(view.queryByText(ALL_LOGGED)).not.toBeInTheDocument();
    // Acotado a la tarjeta: el widget de progreso usa "Sin registrar" como etiqueta de contador.
    const mealsCard = view.getByRole('region', { name: 'Comidas de hoy' });
    for (const chip of STATUS_CHIPS) {
      expect(within(mealsCard).queryByText(chip)).not.toBeInTheDocument();
    }
    expect(view.getByText(PARTIAL_NOTE)).toBeInTheDocument();
  });

  it('unknown status string from the backend: does not throw and that row shows no chip', () => {
    const meals = [
      meal({ plannedMealId: 'breakfast', mealType: 'BREAKFAST', status: 'PARTIAL' as MealCompletionStatus }),
      meal({ plannedMealId: 'lunch', mealType: 'LUNCH', status: 'NOT_LOGGED' }),
    ];

    const { view } = renderView(viewModel({ todayMeals: readyMeals(meals) }));

    const items = within(todayMealsList(view)).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const breakfast = items[0]!;
    expect(within(breakfast).getByText('Receta de prueba breakfast')).toBeInTheDocument();
    for (const chip of STATUS_CHIPS) {
      expect(within(breakfast).queryByText(chip)).not.toBeInTheDocument();
    }
    expect(breakfast.textContent ?? '').not.toMatch(/PARTIAL|undefined/);
    expect(within(items[1]!).getByText('Receta de prueba lunch')).toBeInTheDocument();
    expect(view.getByRole('heading', { level: 1, name: 'Hola, María' })).toBeInTheDocument();
    expect(view.getByRole('navigation', { name: 'Accesos rápidos' })).toBeInTheDocument();
  });

  it('unknown status string counts as unknown: no all-logged claim and the unavailable-status note (§16)', () => {
    const meals = [
      meal({ plannedMealId: 'breakfast', mealType: 'BREAKFAST', status: 'PARTIAL' as MealCompletionStatus }),
      meal({ plannedMealId: 'lunch', mealType: 'LUNCH', status: 'COMPLETED' }),
    ];

    const { view } = renderView(viewModel({ todayMeals: readyMeals(meals) }));

    expect(view.queryByText(ALL_LOGGED)).not.toBeInTheDocument();
    expect(view.getByText(PARTIAL_NOTE)).toBeInTheDocument();
    expect(view.queryByText(NEXT_MEAL_TITLE)).not.toBeInTheDocument();
  });

  it('error: shows both error messages as alerts, each with an always-present "Reintentar" (§16)', () => {
    const { view } = renderFixture('error');

    expect(view.getByText(MEALS_ERROR).closest('[role="alert"]')).not.toBeNull();
    expect(view.getByText(PROGRESS_ERROR).closest('[role="alert"]')).not.toBeNull();
    const meals = view.getByRole('region', { name: 'Comidas de hoy' });
    const progress = view.getByRole('region', { name: 'Progreso de la semana' });
    expect(within(meals).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(within(progress).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(view.queryByText(NEXT_MEAL_TITLE)).not.toBeInTheDocument();
  });

  it('error fixture: both "Reintentar" buttons call the onRetry passed to selectDashboardFixture', async () => {
    const onRetry = vi.fn();
    const { view } = renderFixture('error', 'María José', onRetry);

    await userEvent.click(
      within(view.getByRole('region', { name: 'Comidas de hoy' })).getByRole('button', { name: 'Reintentar' }),
    );
    await userEvent.click(
      within(view.getByRole('region', { name: 'Progreso de la semana' })).getByRole('button', { name: 'Reintentar' }),
    );

    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('error: "Reintentar" calls the today meals retry', async () => {
    const retry = vi.fn();
    const { view } = renderView(
      viewModel({
        todayMeals: { kind: 'error', retry },
        adherence: readyAdherence(),
      }),
    );

    await userEvent.click(view.getByRole('button', { name: 'Reintentar' }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('error: "Reintentar" in the progress slot calls the adherence retry', async () => {
    const retry = vi.fn();
    const { view } = renderView(
      viewModel({
        todayMeals: readyMeals(UNORDERED_MEALS),
        adherence: { data: null, loading: false, error: 'fallo de red', onRetry: retry },
      }),
    );

    const slot = view.getByRole('region', { name: 'Progreso de la semana' });
    await userEvent.click(within(slot).getByRole('button', { name: 'Reintentar' }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('partial error: lists meals without chips, shows the note and the progress slot error with retry', async () => {
    const onRetry = vi.fn();
    const { view } = renderFixture('error-parcial', 'María José', onRetry);

    expect(within(todayMealsList(view)).getAllByRole('listitem')).toHaveLength(
      fixtureMeals('error-parcial').length,
    );
    for (const chip of STATUS_CHIPS) {
      expect(view.queryByText(chip)).not.toBeInTheDocument();
    }
    expect(view.getByText(PARTIAL_NOTE)).toBeInTheDocument();
    expect(view.queryByText(NEXT_MEAL_TITLE)).not.toBeInTheDocument();

    const slot = view.getByRole('region', { name: 'Progreso de la semana' });
    expect(within(slot).getByRole('alert')).toHaveTextContent(PROGRESS_ERROR);
    await userEvent.click(within(slot).getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('unavailable: both cards say "No disponible todavía" with no loading indicator', () => {
    const { container, view } = renderFixture('no-disponible');

    expect(view.getAllByText(UNAVAILABLE)).toHaveLength(2);
    expect(within(view.getByRole('region', { name: 'Comidas de hoy' })).getByText(UNAVAILABLE)).toBeInTheDocument();
    expect(within(view.getByRole('region', { name: 'Progreso de la semana' })).getByText(UNAVAILABLE)).toBeInTheDocument();
    expect(view.getByText('Pronto vas a ver aquí tus comidas del día.')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(view.queryByText(NEXT_MEAL_TITLE)).not.toBeInTheDocument();
  });
});

describe('DashboardView progress widget', () => {
  it('renders the backend summary passed in the view model', () => {
    const { view } = renderView(viewModel({ adherence: createAdherenceWidgetProps('partial') }));

    const progress = view.getByRole('region', { name: 'Progreso de la semana' });
    expect(within(progress).getByText('32,1 %')).toBeInTheDocument();
    expect(within(progress).getByText('9 de 28 comidas completadas')).toBeInTheDocument();
  });

  it.each<DashboardFixtureKey>(['loading', 'error', 'error-parcial', 'no-disponible'])(
    'never shows digits or "%" without adherence data (%s fixture)',
    (key) => {
      const { view } = renderFixture(key);

      const progress = view.getByRole('region', { name: 'Progreso de la semana' });
      expect(progress.textContent ?? '').not.toMatch(/\d|%/);
    },
  );

  it('never shows the internal error message', () => {
    const { view } = renderView(
      viewModel({ adherence: { data: null, loading: false, error: 'Error 500: 85%', onRetry: () => undefined } }),
    );

    const progress = view.getByRole('region', { name: 'Progreso de la semana' });
    expect(progress.textContent ?? '').not.toMatch(/\d|%/);
  });
});

describe('DashboardView quick access', () => {
  it('renders exactly three links to existing routes', () => {
    const { view } = renderFixture('comidas');

    const nav = view.getByRole('navigation', { name: 'Accesos rápidos' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(within(nav).getByRole('link', { name: /Ver mi plan semanal/ })).toHaveAttribute('href', '/meal-plan');
    expect(within(nav).getByRole('link', { name: /Explorar recetas/ })).toHaveAttribute('href', '/recipes');
    expect(within(nav).getByRole('link', { name: /Lista de compras/ })).toHaveAttribute('href', '/shopping-list');
    expect(within(nav).getByText('Revisá las comidas de la semana')).toBeInTheDocument();
    expect(within(nav).getByText('Buscá ideas y preparaciones')).toBeInTheDocument();
    expect(within(nav).getByText('3 de 8 marcados')).toBeInTheDocument();
  });

  it('has no generate-plan nor profile access', () => {
    const { view } = renderFixture('comidas');

    expect(view.queryByRole('link', { name: /generar/i })).not.toBeInTheDocument();
    expect(view.queryByText(/generar/i)).not.toBeInTheDocument();
    expect(view.queryByText(/perfil/i)).not.toBeInTheDocument();
  });
});

describe('DashboardView exclusions', () => {
  it.each(FIXTURE_KEYS)('never shows premium, streaks, achievements, notifications, hydration or tips (%s)', (key) => {
    const { container, view } = renderFixture(key);

    expect(container.textContent ?? '').not.toMatch(EXCLUDED_COPY);
    expect(view.queryByRole('button', { name: /notificaci/i })).not.toBeInTheDocument();
  });
});

// §15: ajustes tras la comparación visual con Stitch.
describe('DashboardView Stitch visual fixes (§15)', () => {
  it('places each status chip after the title, inside the same text column', () => {
    const { view } = renderView(viewModel({ todayMeals: readyMeals(UNORDERED_MEALS) }));

    const items = within(todayMealsList(view)).getAllByRole('listitem');
    const expected = [
      ['Receta de prueba breakfast', 'Completada'],
      ['Receta de prueba lunch', 'Sin registrar'],
      ['Receta de prueba snack', 'Omitida'],
      ['Receta de prueba dinner', 'Sin registrar'],
    ];
    items.forEach((item, index) => {
      const [titleText, chipText] = expected[index]!;
      const title = within(item).getByText(titleText!);
      const chip = within(item).getByText(chipText!);
      const textColumn = title.parentElement!;

      expect(textColumn).not.toBe(item);
      expect(textColumn).toContainElement(chip);
      expect(title.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it('renders no image nor image placeholder in the next meal highlight when the meal has no image', () => {
    const { view } = renderFixture('comidas');

    const highlight = view.getByRole('region', { name: NEXT_MEAL_TITLE });
    expect(within(highlight).queryByRole('img')).not.toBeInTheDocument();
    expect(highlight.querySelector('img')).toBeNull();
    expect(within(highlight).queryByLabelText(/Imagen no disponible/)).not.toBeInTheDocument();
  });

  it('keeps the heading as the region name with the meal-type chip in its header row, before the card body', () => {
    const { view } = renderView(viewModel({ todayMeals: readyMeals(UNORDERED_MEALS) }));

    const highlight = view.getByRole('region', { name: NEXT_MEAL_TITLE });
    const heading = within(highlight).getByRole('heading', { name: NEXT_MEAL_TITLE });
    const chip = within(highlight).getByText('Almuerzo');
    const title = within(highlight).getByText('Receta de prueba lunch');
    const headerRow = heading.parentElement!;

    expect(headerRow).toContainElement(chip);
    expect(headerRow).not.toContainElement(title);
    expect(heading.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(headerRow.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sizes the greeting text-2xl on mobile and text-3xl from md', () => {
    const { view } = renderView(viewModel({ userName: 'María José' }));

    expect(view.getByRole('heading', { level: 1 })).toHaveClass('text-2xl', 'md:text-3xl');
  });

  it('wraps each quick-access icon in a 48px tile (h-12 w-12)', () => {
    const { view } = renderFixture('comidas');

    const nav = view.getByRole('navigation', { name: 'Accesos rápidos' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.querySelector('.h-12.w-12')).not.toBeNull();
    }
  });
});
