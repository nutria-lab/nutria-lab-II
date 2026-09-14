import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MealPlanPage } from './MealPlanPage';
import { mealPlanService } from '../../../services/mealPlanService';
import { useMealPlan } from '../hooks/useMealPlan';

// NUT-10: fixture inline con la forma REAL del backend (ver
// .plans/nut-10-integrar-plan-de-comidas/plan.md sección 3). No usar
// `apps/web/src/modules/meal-plan/mealPlanFixture.ts` (contrato viejo).

vi.mock('../../../services/mealPlanService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/mealPlanService')>();
  return {
    ...actual,
    mealPlanService: { getCurrentMealPlan: vi.fn(), generateMealPlan: vi.fn() },
  };
});

// Solo se sobreescribe el valor de retorno puntualmente (mockReturnValueOnce) para el caso
// `unauthorized`, que hoy no existe en el hook real. El resto de los tests usa la
// implementación real (`actual.useMealPlan`), envuelta por conveniencia de mockeo.
vi.mock('../hooks/useMealPlan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useMealPlan')>();
  return {
    ...actual,
    useMealPlan: vi.fn(actual.useMealPlan),
  };
});

function buildDay(day: string, date: string, meals: unknown[]) {
  return { id: `day-${date}`, mealPlanId: 'plan-1', day, date, meals };
}

const REAL_MEAL_PLAN = {
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

    await user.click(screen.getByRole('button', { name: /Avena con frutos rojos/ }));

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

  // Decisión 5: `unauthorized` debe ofrecer una acción distinta de "Reintentar". El hook
  // real todavía no expone este estado, así que se lo forzamos vía mock puntual del hook
  // para poder ejercitar la pantalla contra él.
  it('shows a distinct action for "unauthorized", not the generic retry button used for a generic error', async () => {
    vi.mocked(useMealPlan).mockReturnValueOnce({
      mealPlan: null,
      status: 'unauthorized' as never,
      errorMessage: null,
      retry: vi.fn(),
      generate: vi.fn(),
    });

    renderMealPlanPage();

    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(await screen.findByText(/sesión|iniciar sesión|reautenticar/i)).toBeInTheDocument();
  });
});
