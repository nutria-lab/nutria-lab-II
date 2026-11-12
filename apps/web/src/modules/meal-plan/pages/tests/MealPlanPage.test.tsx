import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MealPlanPage } from '@/modules/meal-plan/pages/MealPlanPage';
import { mealPlanService } from '@/services/mealPlanService';
import { REPLACE_MEAL_ERROR_MESSAGE } from '@/modules/meal-plan/hooks/useReplaceMeal';
import { adherenceService } from '@/services/adherenceService';
import type { MealPlan, MealPlanDay } from '@/services/mealPlanService';
import type { AdherenceResponse } from '@/modules/adherence/types';

// NUT-10: fixture inline con la forma REAL del backend (ver
// .plans/nut-10-integrar-plan-de-comidas/plan.md sección 3). No usar
// `apps/web/src/modules/meal-plan/mealPlanFixture.ts` (contrato viejo).

// NUT-10 (sexta iteración) — Observación 1 del revisor externo (Request changes): se
// elimina el bypass de auth local (`UnauthorizedState`, `useAuth().logout()` desde esta
// página, estado `unauthorized` del hook). El `apiClient`/`AuthProvider` global ya maneja
// 401/403 de forma consistente para toda la app. Se borran, en consecuencia: los tests que
// ejercitaban `UnauthorizedState`/el botón "Iniciar sesión", el mock puntual de `useMealPlan`
// que solo existía para forzar ese estado inexistente en el hook real, y el mock de
// `../../../features/auth/AuthProvider` (no lo usa ningún otro test de este archivo).

vi.mock('@/services/mealPlanService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/mealPlanService')>();
  return {
    ...actual,
    mealPlanService: {
      getCurrentMealPlan: vi.fn(),
      generateMealPlan: vi.fn(),
      regenerateMealPlan: vi.fn(),
      replacePlannedMeal: vi.fn(),
    },
  };
});
vi.mock('@/services/adherenceService', () => ({
  adherenceService: { getForWeek: vi.fn(), setMealStatus: vi.fn() },
}));
vi.mock('../../../../features/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'user-1' } }),
}));

function buildDay(day: MealPlanDay['day'], date: string, meals: MealPlanDay['meals']): MealPlanDay {
  return { id: `day-${date}`, mealPlanId: 'plan-1', day, date, meals };
}

const REAL_MEAL_PLAN: MealPlan = {
  id: 'plan-1',
  userId: 'user-1',
  startDate: '2026-08-24T00:00:00.000Z',
  endDate: '2026-08-26T00:00:00.000Z',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
  days: [
    buildDay('MONDAY', '2026-08-24', [
      {
        id: 'meal-1',
        dayId: 'day-2026-08-24',
        mealType: 'BREAKFAST',
        title: 'Avena con frutos rojos',
        nutritionalValues: { Protein: 12, Fiber: 5, Calories: 320, Description: 'Rica en fibra' },
        recipeId: 'recipe-1',
        recipe: {
          id: 'recipe-1',
          title: 'Avena con frutos rojos',
          description: 'Desayuno rápido',
          prepMinutes: 5,
          cookMinutes: 0,
          ingredients: [{ name: 'Avena', quantity: 1, unit: 'taza' }],
          instructions: ['Mezclar todo'],
        },
      },
    ]),
    buildDay('TUESDAY', '2026-08-25', [
      {
        id: 'meal-2',
        dayId: 'day-2026-08-25',
        mealType: 'LUNCH',
        title: 'Comida sin receta asignada',
        nutritionalValues: { Protein: 20, Fiber: 3, Calories: 450, Description: 'Balanceada' },
        recipeId: null,
        recipe: null,
      },
    ]),
    buildDay('WEDNESDAY', '2026-08-26', [
      {
        id: 'meal-3',
        dayId: 'day-2026-08-26',
        mealType: 'DINNER',
        title: 'Bowl de quinoa y vegetales',
        nutritionalValues: { Protein: 18, Fiber: 6, Calories: 400, Description: 'Cena liviana' },
        recipeId: 'recipe-3',
        recipe: {
          id: 'recipe-3',
          title: 'Bowl de quinoa y vegetales',
          description: 'Cena vegetariana',
          prepMinutes: 10,
          cookMinutes: 15,
          ingredients: [{ name: 'Quinoa', quantity: 1, unit: 'taza' }],
          instructions: ['Cocinar la quinoa'],
        },
      },
    ]),
  ],
};

const REAL_7_DAY_MEAL_PLAN: MealPlan = {
  id: 'plan-1',
  userId: 'user-1',
  startDate: '2026-08-24T00:00:00.000Z',
  endDate: '2026-08-30T00:00:00.000Z',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
  days: [
    buildDay('MONDAY', '2026-08-24', [
      {
        id: 'meal-1',
        dayId: 'day-2026-08-24',
        mealType: 'BREAKFAST',
        title: 'Avena con frutos rojos',
        nutritionalValues: { Protein: 12, Fiber: 5, Calories: 320, Description: 'Rica en fibra' },
        recipeId: 'recipe-1',
        recipe: {
          id: 'recipe-1',
          title: 'Avena con frutos rojos',
          description: 'Desayuno rápido',
          prepMinutes: 5,
          cookMinutes: 0,
          ingredients: [{ name: 'Avena', quantity: 1, unit: 'taza' }],
          instructions: ['Mezclar todo'],
        },
      },
    ]),
    buildDay('TUESDAY', '2026-08-25', []),
    buildDay('WEDNESDAY', '2026-08-26', []),
    buildDay('THURSDAY', '2026-08-27', []),
    buildDay('FRIDAY', '2026-08-28', []),
    buildDay('SATURDAY', '2026-08-29', []),
    buildDay('SUNDAY', '2026-08-30', [
      {
        id: 'meal-sunday',
        dayId: 'day-2026-08-30',
        mealType: 'DINNER',
        title: 'Cena de domingo',
        nutritionalValues: { Protein: 25, Fiber: 4, Calories: 500, Description: 'Cena dominical' },
        recipeId: 'recipe-sunday',
        recipe: {
          id: 'recipe-sunday',
          title: 'Cena de domingo',
          description: 'Cena especial',
          prepMinutes: 15,
          cookMinutes: 20,
          ingredients: [{ name: 'Pollo', quantity: 200, unit: 'g' }],
          instructions: ['Cocinar'],
        },
      },
    ]),
  ],
};

const EMPTY_ADHERENCE: AdherenceResponse = {
  weekStart: '2026-08-24',
  timezone: 'America/Argentina/Buenos_Aires',
  today: '2026-08-24',
  plan: { id: 'plan-1', version: 1, updatedAt: '2026-08-20T00:00:00.000Z' },
  days: [],
  summary: { plannedMeals: 0, completedMeals: 0, skippedMeals: 0, notLoggedMeals: 0, adherencePercent: null },
};

function adherenceForFirstMeal(plan: MealPlan): AdherenceResponse {
  const day = plan.days[0];
  const meal = day.meals[0];
  if (!meal) throw new Error('Missing meal fixture');
  return {
    weekStart: day.date,
    timezone: 'America/Argentina/Buenos_Aires',
    today: day.date,
    plan: { id: plan.id, version: 1, updatedAt: plan.updatedAt },
    days: [{
      date: day.date,
      plannedMeals: 1,
      completedMeals: 0,
      skippedMeals: 0,
      notLoggedMeals: 1,
      adherencePercent: 0,
      meals: [{
        plannedMealId: meal.id,
        mealUpdatedAt: plan.updatedAt,
        recipeId: meal.recipeId,
        mealType: meal.mealType as 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK',
        title: meal.title,
        status: 'NOT_LOGGED',
        canEdit: true,
      }],
    }],
    summary: { plannedMeals: 1, completedMeals: 0, skippedMeals: 0, notLoggedMeals: 1, adherencePercent: 0 },
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderMealPlanPage(initialEntries: string[] = ['/meal-plan']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <LocationProbe />
      <MealPlanPage />
    </MemoryRouter>,
  );
}

describe('MealPlanPage', () => {
  beforeEach(() => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockReset();
    vi.mocked(mealPlanService.generateMealPlan).mockReset();
    vi.mocked(adherenceService.getForWeek).mockReset().mockResolvedValue(EMPTY_ADHERENCE);
    vi.mocked(adherenceService.setMealStatus).mockReset();
  });

  it('renders the plan for the first day once loaded', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(REAL_MEAL_PLAN as never);

    renderMealPlanPage();

    expect(await screen.findByText('Tu plan semanal')).toBeInTheDocument();
    expect(screen.getByText('Avena con frutos rojos')).toBeInTheDocument();
  });

  it('lets the user switch to another day', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(REAL_MEAL_PLAN as never);
    const user = userEvent.setup();

    renderMealPlanPage();
    await screen.findByText('Avena con frutos rojos');

    await user.click(screen.getByRole('tab', { name: /25/ }));

    await waitFor(() => {
      expect(screen.queryByText('Avena con frutos rojos')).not.toBeInTheDocument();
    });
  });

  it('shows the empty state when there is no plan for the week', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(null);

    renderMealPlanPage();

    expect(await screen.findByText('Todavía no tenés un plan para esta semana')).toBeInTheDocument();
  });

  it('expands the inline recipe accordion for a meal without losing the selected day', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(REAL_MEAL_PLAN as never);
    const user = userEvent.setup();

    renderMealPlanPage();
    await screen.findByText('Avena con frutos rojos');

    // aria-expanded distingue el botón del acordeón del botón de reemplazar
    await user.click(screen.getByRole('button', { expanded: false }));

    expect(await screen.findByText('Mezclar todo')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /24/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows a retry option on error and recovers when the retry succeeds', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockRejectedValueOnce(new Error('network error'));
    const user = userEvent.setup();

    renderMealPlanPage();

    expect(await screen.findByText('Algo salió mal')).toBeInTheDocument();

    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValueOnce(REAL_MEAL_PLAN as never);
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Tu plan semanal')).toBeInTheDocument();
  });

  // --- NUT-10: casos nuevos (hoy en rojo) ---------------------------------------------

  // Decisión 3 del design.md: el día seleccionado vive en un query param (`?day=`), no en
  // un useState local. Hoy `MealPlanPage.tsx` usa `useState` (líneas 71-79) y por lo tanto
  // ignora cualquier `?day=` presente al montar.
  it('respects the day already present in the URL on mount, instead of defaulting to the first day', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(REAL_MEAL_PLAN as never);

    renderMealPlanPage(['/meal-plan?day=2026-08-26']);

    await screen.findByText('Tu plan semanal');

    expect(screen.getByRole('tab', { name: /26/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /24/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('writes the selected day to the URL "day" query param so it survives a reload', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(REAL_MEAL_PLAN as never);
    const user = userEvent.setup();

    renderMealPlanPage(['/meal-plan']);
    await screen.findByText('Tu plan semanal');

    await user.click(screen.getByRole('tab', { name: /25/ }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search').textContent).toContain('day=2026-08-25');
    });
  });

  // Historia H4: el botón "Generar plan" del estado vacío hoy no tiene `onClick`
  // (`MealPlanPage.tsx` líneas 43-48) y `mealPlanService.generateMealPlan` no existe todavía.
  it('wires the "Generar plan" button to the generation service and shows the generated plan', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(null);
    vi.mocked(mealPlanService.generateMealPlan).mockResolvedValue(REAL_MEAL_PLAN as never);
    const user = userEvent.setup();

    renderMealPlanPage();
    await screen.findByText('Todavía no tenés un plan para esta semana');

    await user.click(screen.getByRole('button', { name: 'Generar plan' }));

    await waitFor(() => expect(mealPlanService.generateMealPlan).toHaveBeenCalled());
    expect(await screen.findByText('Tu plan semanal')).toBeInTheDocument();
  });

  it('unshackles desktop container from rigid max-w-lg', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(REAL_7_DAY_MEAL_PLAN as never);

    renderMealPlanPage();
    await screen.findByText('Tu plan semanal');

    const mainElement = screen.getByRole('main');
    expect(mainElement.className).toContain('xl:max-w-7xl');
  });

  it('renders 7-day weekly grid on desktop', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(REAL_7_DAY_MEAL_PLAN as never);

    renderMealPlanPage();
    await screen.findByText('Tu plan semanal');

    expect(screen.getByTestId('weekly-grid')).toBeInTheDocument();
    const columns = screen.getAllByTestId('day-column');
    expect(columns).toHaveLength(7);
    const singleDayView =
      screen.queryByTestId('single-day-view') ?? screen.getByRole('tablist').closest('.space-y-6');
    expect(singleDayView).toHaveClass('xl:hidden');
  });

  it('connects both card layouts to the current meal status by plannedMealId', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(REAL_7_DAY_MEAL_PLAN as never);
    vi.mocked(adherenceService.getForWeek).mockResolvedValue(adherenceForFirstMeal(REAL_7_DAY_MEAL_PLAN));
    vi.mocked(adherenceService.setMealStatus).mockResolvedValue({
      plannedMealId: 'meal-1',
      status: 'COMPLETED',
      updatedAt: '2026-08-24T13:00:00.000Z',
    });
    const user = userEvent.setup();

    renderMealPlanPage();
    await screen.findByText('Tu plan semanal');
    const statusSelectors = await screen.findAllByRole('combobox', { name: 'Estado de Avena con frutos rojos' });
    expect(statusSelectors).toHaveLength(2);
    await user.selectOptions(statusSelectors[0], 'COMPLETED');

    await waitFor(() => expect(adherenceService.setMealStatus).toHaveBeenCalledWith(
      'meal-1',
      expect.objectContaining({
        planId: 'plan-1',
        mealUpdatedAt: REAL_7_DAY_MEAL_PLAN.updatedAt,
        status: 'COMPLETED',
      }),
      expect.any(AbortSignal),
    ));
  });

  it('renders Sunday in the 7th column with Sunday planned meals', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(REAL_7_DAY_MEAL_PLAN as never);

    renderMealPlanPage();
    await screen.findByText('Tu plan semanal');

    const columns = screen.getAllByTestId('day-column');
    const sundayColumn = columns[6];
    expect(sundayColumn).toHaveTextContent(/domingo/i);
    expect(sundayColumn).toHaveTextContent(/30 AGO/i);
    expect(within(sundayColumn).getByText('Cena de domingo')).toBeInTheDocument();
  });

  it('renders day selector and meal cards on desktop viewports without blanking when days.length !== 7', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(REAL_MEAL_PLAN as never);

    renderMealPlanPage();
    await screen.findByText('Tu plan semanal');

    expect(screen.queryByTestId('weekly-grid')).not.toBeInTheDocument();

    const singleDayView =
      screen.queryByTestId('single-day-view') ?? screen.getByRole('tablist').closest('.space-y-6');
    expect(singleDayView).not.toHaveClass('xl:hidden');
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByText('Avena con frutos rojos')).toBeInTheDocument();
  });

  it('shows empty state when mealPlan has no days (days: [])', async () => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue({
      id: 'plan-empty-days',
      userId: 'user-1',
      startDate: '2026-08-24T00:00:00.000Z',
      endDate: '2026-08-30T00:00:00.000Z',
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
      days: [],
    } as never);

    renderMealPlanPage();

    expect(await screen.findByText('Todavía no tenés un plan para esta semana')).toBeInTheDocument();
  });
});

// En jsdom se renderizan la vista móvil y la grilla de escritorio a la vez, así que
// las consultas de escritorio se acotan a `weekly-grid` ("Cambiar comida …") y las de móvil
// a la vista compacta ("Reemplazar comida …").
describe('MealPlanPage — reemplazo de comida en escritorio', () => {
  const ORIGINAL_TITLE = 'Avena con frutos rojos';
  const NEW_TITLE = 'Tostadas con palta';
  const SUNDAY_TITLE = 'Cena de domingo';
  const RAW_ERROR = 'Request failed with status code 503';
  const FIXED_ERROR = REPLACE_MEAL_ERROR_MESSAGE;
  const firstMeal = REAL_7_DAY_MEAL_PLAN.days[0].meals[0];
  const sundayMeal = REAL_7_DAY_MEAL_PLAN.days[6].meals[0];
  const REPLACED_MEAL = {
    ...firstMeal,
    title: NEW_TITLE,
    recipeId: 'recipe-new',
    recipe: { ...firstMeal.recipe!, id: 'recipe-new', title: NEW_TITLE },
  };
  const REPLACED_SUNDAY = {
    ...sundayMeal,
    title: 'Pescado al horno',
    recipeId: 'recipe-fish',
    recipe: { ...sundayMeal.recipe!, id: 'recipe-fish', title: 'Pescado al horno' },
  };

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  const grid = () => screen.getByTestId('weekly-grid');
  const mobileView = () => screen.getByRole('tablist').closest('.space-y-6') as HTMLElement;
  const desktopTrigger = (title: string) =>
    within(grid()).getByRole('button', { name: `Cambiar comida ${title}` });
  const cardOf = (title: string) => within(grid()).getByText(title).closest('article')!;

  async function renderDesktopPlan(initialEntries?: string[]) {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockResolvedValue(REAL_7_DAY_MEAL_PLAN as never);
    const user = userEvent.setup();
    renderMealPlanPage(initialEntries);
    await screen.findByText('Tu plan semanal');
    return user;
  }

  async function openDialog(user: ReturnType<typeof userEvent.setup>, title = ORIGINAL_TITLE) {
    await user.click(desktopTrigger(title));
    return screen.findByRole('dialog', { name: `Reemplazar ${title}` });
  }

  async function confirmReplacement(user: ReturnType<typeof userEvent.setup>) {
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Reemplazar comida' }));
  }

  async function confirmMobileReplacement(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(mobileView()).getByRole('button', { name: `Reemplazar comida ${ORIGINAL_TITLE}` }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const confirmRegion = within(mobileView()).getByRole('region', { name: `Confirmar reemplazo de ${ORIGINAL_TITLE}` });
    await user.click(within(confirmRegion).getByRole('button', { name: 'Reemplazar comida' }));
  }

  beforeEach(() => {
    vi.mocked(mealPlanService.getCurrentMealPlan).mockReset();
    vi.mocked(mealPlanService.replacePlannedMeal).mockReset();
    vi.mocked(mealPlanService.regenerateMealPlan).mockReset();
    vi.mocked(adherenceService.getForWeek).mockReset().mockResolvedValue(EMPTY_ADHERENCE);
  });

  it('opens an accessible confirmation dialog that names the meal and moves focus into it', async () => {
    const user = await renderDesktopPlan();

    const dialog = await openDialog(user);

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(
      'Solo se cambiará este plato. Las demás comidas de tu plan se mantendrán iguales.',
    );
    expect(within(dialog).getByRole('button', { name: 'Reemplazar comida' })).toHaveFocus();
    expect(mealPlanService.replacePlannedMeal).not.toHaveBeenCalled();
  });

  it('traps keyboard focus inside the dialog while it is open', async () => {
    const user = await renderDesktopPlan();
    const dialog = await openDialog(user);
    const cancel = within(dialog).getByRole('button', { name: 'Cancelar' });
    const confirm = within(dialog).getByRole('button', { name: 'Reemplazar comida' });

    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });

  it('Cancelar closes the dialog without requests and returns focus to the trigger', async () => {
    const user = await renderDesktopPlan();
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mealPlanService.replacePlannedMeal).not.toHaveBeenCalled();
    expect(within(grid()).getByText(ORIGINAL_TITLE)).toBeInTheDocument();
    expect(desktopTrigger(ORIGINAL_TITLE)).toHaveFocus();
  });

  it('Escape closes the dialog without requests and returns focus to the trigger', async () => {
    const user = await renderDesktopPlan();
    await openDialog(user);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mealPlanService.replacePlannedMeal).not.toHaveBeenCalled();
    expect(desktopTrigger(ORIGINAL_TITLE)).toHaveFocus();
  });

  it('confirming closes the dialog and sends exactly one request', async () => {
    const pending = deferred<typeof REPLACED_MEAL>();
    vi.mocked(mealPlanService.replacePlannedMeal).mockReturnValue(pending.promise as never);
    const user = await renderDesktopPlan();

    await confirmReplacement(user);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mealPlanService.replacePlannedMeal).toHaveBeenCalledTimes(1);
    expect(mealPlanService.replacePlannedMeal).toHaveBeenCalledWith(
      'plan-1',
      'meal-1',
      expect.any(String),
      undefined,
    );
    pending.resolve(REPLACED_MEAL);
    await waitFor(() => expect(within(grid()).getByText(NEW_TITLE)).toBeInTheDocument());
  });

  it('while loading only the affected card is blocked and holds the focus', async () => {
    const pending = deferred<typeof REPLACED_MEAL>();
    vi.mocked(mealPlanService.replacePlannedMeal).mockReturnValue(pending.promise as never);
    const user = await renderDesktopPlan();

    await confirmReplacement(user);

    const card = cardOf(ORIGINAL_TITLE);
    expect(card).toHaveAttribute('aria-busy', 'true');
    expect(card).toHaveFocus();
    expect(desktopTrigger(ORIGINAL_TITLE)).toBeDisabled();
    expect(cardOf(SUNDAY_TITLE)).not.toHaveAttribute('aria-busy', 'true');
    expect(desktopTrigger(SUNDAY_TITLE)).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Regenerar plan' })).toBeEnabled();

    pending.resolve(REPLACED_MEAL);
    await waitFor(() => expect(desktopTrigger(NEW_TITLE)).toHaveFocus());
  });

  it('on success updates only that meal, keeps the selected day and returns focus to the trigger', async () => {
    vi.mocked(mealPlanService.replacePlannedMeal).mockResolvedValue(REPLACED_MEAL as never);
    const user = await renderDesktopPlan(['/meal-plan?day=2026-08-30']);
    const trigger = desktopTrigger(ORIGINAL_TITLE);

    await confirmReplacement(user);

    await waitFor(() => expect(within(grid()).getByText(NEW_TITLE)).toBeInTheDocument());
    expect(within(grid()).queryByText(ORIGINAL_TITLE)).not.toBeInTheDocument();
    expect(within(grid()).getByText(SUNDAY_TITLE)).toBeInTheDocument();
    expect(screen.getByTestId('location-search').textContent).toBe('?day=2026-08-30');
    expect(screen.getByRole('tab', { name: /30/ })).toHaveAttribute('aria-selected', 'true');
    expect(trigger).toHaveAccessibleName(`Cambiar comida ${NEW_TITLE}`);
    expect(trigger).toHaveFocus();
  });

  it('on error keeps the previous card, shows a fixed message with Reintentar/Cancelar and returns focus to the trigger', async () => {
    vi.mocked(mealPlanService.replacePlannedMeal).mockRejectedValue(new Error(RAW_ERROR));
    const user = await renderDesktopPlan();

    await confirmReplacement(user);

    const card = cardOf(ORIGINAL_TITLE);
    await within(card).findByRole('button', { name: 'Reintentar' });
    expect(within(card).getByText(FIXED_ERROR)).toBeInTheDocument();
    expect(screen.queryByText(RAW_ERROR)).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(desktopTrigger(ORIGINAL_TITLE)).toHaveFocus();

    await user.click(within(card).getByRole('button', { name: 'Cancelar' }));
    expect(within(card).queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(within(grid()).getByText(ORIGINAL_TITLE)).toBeInTheDocument();
    expect(desktopTrigger(ORIGINAL_TITLE)).toHaveFocus();
    expect(mealPlanService.replacePlannedMeal).toHaveBeenCalledTimes(1);
  });

  it('retrying after an error reuses the same idempotency key and keeps focus on the card', async () => {
    vi.mocked(mealPlanService.replacePlannedMeal)
      .mockRejectedValueOnce(new Error(RAW_ERROR))
      .mockResolvedValueOnce(REPLACED_MEAL as never);
    const user = await renderDesktopPlan();
    await confirmReplacement(user);
    const retry = await within(grid()).findByRole('button', { name: 'Reintentar' });

    await user.click(retry);

    await waitFor(() => expect(within(grid()).getByText(NEW_TITLE)).toBeInTheDocument());
    const calls = vi.mocked(mealPlanService.replacePlannedMeal).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0]).toBe('plan-1');
    expect(calls[1][1]).toBe('meal-1');
    expect(calls[1][2]).toBe(calls[0][2]);
    expect(desktopTrigger(NEW_TITLE)).toHaveFocus();
  });

  it('closes the dialog when a regeneration replaces the plan while it is open', async () => {
    const regeneration = deferred<MealPlan>();
    vi.mocked(mealPlanService.regenerateMealPlan).mockReturnValue(regeneration.promise as never);
    const user = await renderDesktopPlan();

    await user.click(screen.getByRole('button', { name: 'Regenerar plan' }));
    await user.click(screen.getByRole('button', { name: 'Regenerar semana' }));
    await user.keyboard('{Escape}');
    expect(await screen.findByText('Regenerando tu semana… El plan actual sigue disponible.')).toBeInTheDocument();

    await openDialog(user);
    regeneration.resolve({
      ...REAL_7_DAY_MEAL_PLAN,
      id: 'plan-2',
      days: REAL_7_DAY_MEAL_PLAN.days.map((day) => ({
        ...day,
        mealPlanId: 'plan-2',
        meals: day.meals.map((meal) => ({ ...meal, id: `${meal.id}-v2` })),
      })),
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mealPlanService.replacePlannedMeal).not.toHaveBeenCalled();
  });

  it('blocks confirming a second meal while another replacement is running, without stealing focus', async () => {
    const pending = deferred<typeof REPLACED_MEAL>();
    vi.mocked(mealPlanService.replacePlannedMeal)
      .mockReturnValueOnce(pending.promise as never)
      .mockResolvedValueOnce(REPLACED_SUNDAY as never);
    const user = await renderDesktopPlan();
    await confirmReplacement(user);

    const dialog = await openDialog(user, SUNDAY_TITLE);
    const confirm = within(dialog).getByRole('button', { name: 'Reemplazar comida' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancelar' });
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'Hay otro reemplazo en curso. Vas a poder confirmar cuando termine.',
    );
    expect(cancel).toHaveFocus();

    pending.resolve(REPLACED_MEAL);
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(cancel).toHaveFocus();

    await user.click(confirm);
    await waitFor(() => expect(within(grid()).getByText('Pescado al horno')).toBeInTheDocument());
    expect(mealPlanService.replacePlannedMeal).toHaveBeenCalledTimes(2);
    expect(vi.mocked(mealPlanService.replacePlannedMeal).mock.calls[1][1]).toBe('meal-sunday');
  });

  it('keeps the mobile in-card confirmation working without opening the desktop dialog', async () => {
    vi.mocked(mealPlanService.replacePlannedMeal).mockResolvedValue(REPLACED_MEAL as never);
    const user = await renderDesktopPlan(['/meal-plan?day=2026-08-24']);

    await confirmMobileReplacement(user);

    await waitFor(() => expect(within(mobileView()).getByText(NEW_TITLE)).toBeInTheDocument());
    expect(mealPlanService.replacePlannedMeal).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the fixed error message on mobile instead of the technical one', async () => {
    vi.mocked(mealPlanService.replacePlannedMeal).mockRejectedValue(new Error(RAW_ERROR));
    const user = await renderDesktopPlan(['/meal-plan?day=2026-08-24']);

    await confirmMobileReplacement(user);

    expect(await within(mobileView()).findByText(FIXED_ERROR)).toBeInTheDocument();
    expect(screen.queryByText(RAW_ERROR)).not.toBeInTheDocument();
    expect(within(mobileView()).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(within(mobileView()).getByText(ORIGINAL_TITLE)).toBeInTheDocument();
  });
});
