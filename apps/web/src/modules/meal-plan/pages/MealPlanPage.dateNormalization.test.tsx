import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MealPlanPage } from './MealPlanPage';
import { apiClient } from '../../../services/apiClient';

// NUT-10 (sexta iteración) — Observación 2 del revisor externo (Request changes): el backend
// devuelve `MealPlanDay.date` como datetime ISO completo (`'2026-08-24T00:00:00.000Z'`), no
// como `'YYYY-MM-DD'`. Hoy `mealPlanService.ts` lo pasa tal cual, y `MealPlanPage.tsx` compara
// ese valor crudo contra fechas cortas (`formatLocalDateKey(new Date())`, el query param
// `?day=`), así que nunca matchea.
//
// La corrección normaliza `date` DENTRO de `mealPlanService.ts` (no en `MealPlanPage.tsx` ni
// en `WeekSelector.tsx`). Por eso este archivo, a diferencia de `MealPlanPage.test.tsx`, NO
// mockea `mealPlanService`: mockea un nivel más abajo (`apiClient`) para dejar correr el
// `mealPlanService` REAL y así ejercitar la normalización de punta a punta (service -> hook ->
// página), tal como lo pidió explícitamente el revisor. Los 3 tests se esperan en ROJO hoy.

vi.mock('../../../services/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

function buildIsoMeal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'meal-1',
    dayId: 'day-1',
    mealType: 'BREAKFAST',
    title: 'Avena con frutos rojos',
    nutritionalValues: { Protein: 12, Fiber: 5, Calories: 320, Description: 'Rica en fibra' },
    recipeId: 'recipe-1',
    recipe: null,
    ...overrides,
  };
}

function buildIsoDay(day: string, isoDate: string, meals: unknown[]) {
  return { id: `day-${isoDate}`, mealPlanId: 'plan-iso-1', day, date: isoDate, meals };
}

// Fixture con la forma ISO REAL que devuelve el backend — a propósito distinta de la forma
// corta ('2026-08-24') que usan los fixtures de `MealPlanPage.test.tsx`.
const ISO_MEAL_PLAN = {
  id: 'plan-iso-1',
  userId: 'user-1',
  startDate: '2026-08-24T00:00:00.000Z',
  endDate: '2026-08-30T00:00:00.000Z',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
  days: [
    buildIsoDay('MONDAY', '2026-08-24T00:00:00.000Z', [buildIsoMeal({ title: 'Avena con frutos rojos' })]),
    buildIsoDay('TUESDAY', '2026-08-25T00:00:00.000Z', [
      buildIsoMeal({
        id: 'meal-2',
        mealType: 'LUNCH',
        title: 'Comida del martes',
        recipeId: null,
        recipe: null,
      }),
    ]),
    buildIsoDay('WEDNESDAY', '2026-08-26T00:00:00.000Z', [
      buildIsoMeal({
        id: 'meal-3',
        mealType: 'DINNER',
        title: 'Comida del miércoles',
        recipeId: null,
        recipe: null,
      }),
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

describe('MealPlanPage date normalization integration (real mealPlanService, mocked apiClient)', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.post).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('selects today by default when the backend day.date is a full ISO datetime', async () => {
    // "Hoy" fijo en martes 25/08/2026 (local), que matchea el segundo día del fixture.
    // `shouldAdvanceTime` deja que el tiempo real siga corriendo para que `waitFor`/
    // `findBy*` (que dependen de polling interno) sigan funcionando con el reloj controlado.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 25));
    vi.mocked(apiClient.get).mockResolvedValue({ data: ISO_MEAL_PLAN });

    renderMealPlanPage();

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /25/ })).toHaveAttribute('aria-selected', 'true'),
    );
    expect(screen.getByRole('tab', { name: /24/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('selects the day from ?day=YYYY-MM-DD even though the backend returned full ISO datetimes', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: ISO_MEAL_PLAN });

    // A propósito NO es el primer día del plan: si `?day=` no matchea por falta de
    // normalización, `MealPlanPage` cae al fallback `mealPlan.days[0]?.date` (día 24), lo que
    // dejaría este test en falso verde si hubiéramos elegido justo ese día como URL.
    renderMealPlanPage(['/meal-plan?day=2026-08-26']);

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /26/ })).toHaveAttribute('aria-selected', 'true'),
    );
    expect(screen.getByRole('tab', { name: /24/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('writes the short YYYY-MM-DD form to the URL when clicking a day, not the full ISO datetime', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: ISO_MEAL_PLAN });
    const user = userEvent.setup();

    renderMealPlanPage(['/meal-plan?day=2026-08-24']);
    await screen.findByRole('tab', { name: /24/ });

    await user.click(screen.getByRole('tab', { name: /26/ }));

    await waitFor(() => {
      const search = screen.getByTestId('location-search').textContent ?? '';
      expect(search).toContain('day=2026-08-26');
    });
    // Ni el ISO completo crudo ni su forma url-encoded deberían terminar en la URL.
    const search = screen.getByTestId('location-search').textContent ?? '';
    expect(search).not.toContain('T00');
  });
});
