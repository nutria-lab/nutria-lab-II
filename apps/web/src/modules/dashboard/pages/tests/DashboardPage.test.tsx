import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdherenceResponse } from '@/modules/adherence/types';
import { DashboardPage } from '@/modules/dashboard/pages/DashboardPage';
import { dashboardAdherenceService } from '@/modules/dashboard/services/dashboardAdherenceService';
import { dashboardShoppingService } from '@/modules/dashboard/services/dashboardShoppingService';
import type { AuthenticatedUser } from '@/services/authService';
import { mealPlanService, type MealPlan } from '@/services/mealPlanService';

vi.mock('@/services/mealPlanService', () => ({
  mealPlanService: { getCurrentMealPlan: vi.fn() },
}));
vi.mock('@/modules/dashboard/services/dashboardAdherenceService', () => ({
  dashboardAdherenceService: { getForWeek: vi.fn() },
}));
vi.mock('@/modules/dashboard/services/dashboardShoppingService', () => ({
  dashboardShoppingService: { getForWeek: vi.fn() },
}));

const getPlan = vi.mocked(mealPlanService.getCurrentMealPlan);
const getAdherence = vi.mocked(dashboardAdherenceService.getForWeek);
const getShopping = vi.mocked(dashboardShoppingService.getForWeek);

// Miércoles 21/10/2026 en Buenos Aires.
const NOW = new Date('2026-10-21T15:00:00.000Z');
const WEEK = '2026-10-19';
const TODAY = '2026-10-21';
const LIVE_PLAN = { id: 'live-plan', version: 3, updatedAt: '2026-10-18T00:00:00.000Z' };

const liveMealPlan: MealPlan = {
  id: LIVE_PLAN.id,
  userId: 'u1',
  startDate: `${WEEK}T00:00:00.000Z`,
  endDate: '2026-10-25T00:00:00.000Z',
  createdAt: '2026-10-18T00:00:00.000Z',
  updatedAt: '2026-10-18T00:00:00.000Z',
  days: [],
};

type LiveStatus = AdherenceResponse['days'][number]['meals'][number]['status'];

// 32,1 tiene decimal para comprobar que se muestra el valor del contrato A sin recalcular.
function liveAdherence(status: string = 'NOT_LOGGED'): AdherenceResponse {
  return {
    weekStart: WEEK,
    timezone: 'America/Argentina/Buenos_Aires',
    today: TODAY,
    plan: LIVE_PLAN,
    days: [
      {
        date: TODAY,
        plannedMeals: 1,
        completedMeals: 0,
        skippedMeals: 0,
        notLoggedMeals: 1,
        adherencePercent: 0,
        meals: [
          {
            plannedMealId: 'live-lunch',
            mealUpdatedAt: '2026-10-18T00:00:00.000Z',
            recipeId: null,
            mealType: 'LUNCH',
            title: 'Comida real del plan',
            status: status as LiveStatus,
            canEdit: true,
          },
        ],
      },
    ],
    summary: { plannedMeals: 28, completedMeals: 9, skippedMeals: 2, notLoggedMeals: 17, adherencePercent: 32.1 },
  };
}

function mockLiveData(status?: string) {
  getPlan.mockResolvedValue(liveMealPlan);
  getAdherence.mockResolvedValue(liveAdherence(status));
  getShopping.mockResolvedValue({ weekStart: WEEK, plan: LIVE_PLAN, summary: { totalItems: 10, checkedItems: 3 } });
}

const mockAuth = vi.hoisted(() => ({
  user: null as AuthenticatedUser | null,
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: mockAuth.user,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const SESSION_USER: AuthenticatedUser = {
  id: 'u1',
  email: 'a@b.c',
  name: 'María José',
  createdAt: '',
  updatedAt: '',
};

const NO_PLAN = 'Todavía no tenés un plan para esta semana.';
const NEXT_MEAL_TITLE = 'Siguiente comida por registrar';
const ALL_LOGGED = 'Ya registraste todas las comidas de hoy.';
const UNAVAILABLE = 'No disponible todavía';
const FIXTURE_TITLES = /Receta de ejemplo/;

function renderPage(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <DashboardPage />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="location-search">{search}</output>;
}

function renderPageWithProbe(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <DashboardPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

async function expectLiveData() {
  const meals = screen.getByRole('region', { name: 'Comidas de hoy' });
  expect(await within(meals).findByText('Comida real del plan')).toBeVisible();
  expect(screen.queryByText(FIXTURE_TITLES)).not.toBeInTheDocument();
  expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  expect(getPlan).toHaveBeenCalledWith(WEEK, expect.any(AbortSignal));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mockAuth.user = { ...SESSION_USER };
  getPlan.mockReset();
  getAdherence.mockReset();
  getShopping.mockReset();
  mockLiveData();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('DashboardPage in development (fixtures via ?estado)', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', true);
  });

  it('?estado=sin-plan shows the no-plan copy', () => {
    renderPage('/dashboard?estado=sin-plan');

    expect(within(screen.getByRole('region', { name: 'Comidas de hoy' })).getByText(NO_PLAN)).toBeVisible();
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });

  it('?estado=comidas shows the next meal region and the meals list', () => {
    renderPage('/dashboard?estado=comidas');

    expect(screen.getByRole('region', { name: NEXT_MEAL_TITLE })).toBeVisible();
    const todayMeals = within(screen.getByRole('region', { name: 'Comidas de hoy' }));
    expect(todayMeals.getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(todayMeals.getAllByText(FIXTURE_TITLES).length).toBeGreaterThan(0);
  });

  it('?estado=todo-registrado shows the all-logged message', () => {
    renderPage('/dashboard?estado=todo-registrado');

    expect(screen.getByText(ALL_LOGGED)).toBeVisible();
    expect(screen.queryByRole('region', { name: NEXT_MEAL_TITLE })).not.toBeInTheDocument();
  });

  it('greets with the session first name', () => {
    renderPage('/dashboard?estado=comidas');

    expect(screen.getByRole('heading', { level: 1, name: 'Hola, María' })).toBeVisible();
  });

  it('a valid ?estado shows the fixture and requests no real data', () => {
    renderPage('/dashboard?estado=comidas');

    expect(getPlan).not.toHaveBeenCalled();
    expect(getAdherence).not.toHaveBeenCalled();
    expect(getShopping).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', '/dashboard?estado=no-existe'],
    ['empty', '/dashboard?estado='],
    ['missing', '/dashboard'],
  ])('a %s ?estado uses the real data, same as production', async (_label, entry) => {
    renderPage(entry);

    await expectLiveData();
    expect(screen.getByRole('heading', { level: 1, name: 'Hola, María' })).toBeVisible();
  });
});

describe('DashboardPage outside development', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false);
  });

  it('ignores ?estado=comidas and shows the real data with the real name', async () => {
    renderPage('/dashboard?estado=comidas');

    await expectLiveData();
    expect(screen.getByRole('heading', { level: 1, name: 'Hola, María' })).toBeVisible();
  });

  it('CA1: progress shows exactly the contract A percentage and counters', async () => {
    renderPage('/dashboard');

    const progress = screen.getByRole('region', { name: 'Progreso de la semana' });
    expect(await within(progress).findByText('32,1 %')).toBeVisible();
    expect(within(progress).getByText('9 de 28 comidas completadas')).toBeVisible();
  });

  it('CA1: the shopping access shows exactly the contract C counters', async () => {
    renderPage('/dashboard');

    const link = await screen.findByRole('link', { name: /3 de 10 marcados/ });
    expect(link).toHaveAttribute('href', '/shopping-list');
  });

  it('while the first load is in flight every card is loading, never "No disponible todavía"', () => {
    getPlan.mockReturnValue(new Promise(() => {}));
    getAdherence.mockReturnValue(new Promise(() => {}));
    getShopping.mockReturnValue(new Promise(() => {}));
    renderPage('/dashboard');

    const progress = screen.getByRole('region', { name: 'Progreso de la semana' });
    expect(progress.querySelector('[aria-busy="true"]')).not.toBeNull();
    const meals = screen.getByRole('region', { name: 'Comidas de hoy' });
    expect(meals.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });

  it('a single unknown meal status hides the chips, shows the fixed note and claims nothing about logging', async () => {
    mockLiveData('PARTIAL');
    renderPage('/dashboard');

    const meals = screen.getByRole('region', { name: 'Comidas de hoy' });
    expect(await within(meals).findByText('Comida real del plan')).toBeVisible();
    expect(within(meals).getByText('El estado de registro no está disponible por ahora.')).toBeVisible();
    expect(within(meals).queryByText(/Sin registrar|Completada|Omitida/)).not.toBeInTheDocument();
    expect(screen.queryByText(ALL_LOGGED)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: NEXT_MEAL_TITLE })).not.toBeInTheDocument();
  });

  it('without a session user nothing is requested and the cards say "No disponible todavía"', () => {
    mockAuth.user = null;
    const { container } = renderPage('/dashboard');

    expect(getPlan).not.toHaveBeenCalled();
    expect(screen.getAllByText(UNAVAILABLE)).toHaveLength(2);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

describe('DashboardPage dev retry flow (§16)', () => {
  const RETRY_DELAY_MS = 800;

  beforeEach(() => {
    vi.stubEnv('DEV', true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function clickMealsRetry() {
    const meals = screen.getByRole('region', { name: 'Comidas de hoy' });
    fireEvent.click(within(meals).getByRole('button', { name: 'Reintentar' }));
  }

  it('?estado=error → Reintentar goes to estado=loading, then to estado=comidas after the delay', () => {
    const { container } = renderPageWithProbe('/dashboard?estado=error');

    clickMealsRetry();

    expect(new URLSearchParams(screen.getByTestId('location-search').textContent ?? '').get('estado')).toBe('loading');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(NEXT_MEAL_TITLE)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(RETRY_DELAY_MS);
    });

    expect(new URLSearchParams(screen.getByTestId('location-search').textContent ?? '').get('estado')).toBe('comidas');
    expect(screen.getByText(NEXT_MEAL_TITLE)).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it.each(['error', 'progreso-error-actualizacion', 'progreso-desactualizado', 'progreso-inconsistente'])(
    '?estado=%s → progress "Reintentar" goes through loading and ends showing the weekly progress',
    (key) => {
      renderPageWithProbe(`/dashboard?estado=${key}`);
      const progress = () => screen.getByRole('region', { name: 'Progreso de la semana' });

      fireEvent.click(within(progress()).getByRole('button', { name: 'Reintentar' }));
      expect(progress().querySelector('[aria-busy="true"]')).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(RETRY_DELAY_MS);
      });

      expect(new URLSearchParams(screen.getByTestId('location-search').textContent ?? '').get('estado')).toBe('comidas');
      expect(within(progress()).getByRole('progressbar')).toBeInTheDocument();
      expect(within(progress()).queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    },
  );

  it('?estado=compras-error → shopping "Reintentar" goes through loading and ends showing the counters', () => {
    renderPageWithProbe('/dashboard?estado=compras-error');

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(new URLSearchParams(screen.getByTestId('location-search').textContent ?? '').get('estado')).toBe('loading');

    act(() => {
      vi.advanceTimersByTime(RETRY_DELAY_MS);
    });

    expect(screen.getByRole('link', { name: /de \d+ marcados/ })).toBeInTheDocument();
    expect(screen.queryByText('No pudimos cargar el avance de tus compras.')).not.toBeInTheDocument();
  });

  it('unmounting before the delay clears the timer without throwing or warning', () => {
    const errorSpy = vi.spyOn(console, 'error');
    const warnSpy = vi.spyOn(console, 'warn');
    const { unmount } = renderPageWithProbe('/dashboard?estado=error');
    const timersBeforeRetry = vi.getTimerCount();

    clickMealsRetry();
    expect(vi.getTimerCount()).toBeGreaterThan(timersBeforeRetry);

    unmount();
    expect(vi.getTimerCount()).toBeLessThanOrEqual(timersBeforeRetry);
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(RETRY_DELAY_MS * 2);
      });
    }).not.toThrow();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('DashboardPage greeting without a name', () => {
  it.each([true, false])('renders h1 "Hola" when the session name is null (DEV=%s)', (dev) => {
    vi.stubEnv('DEV', dev);
    mockAuth.user = { ...SESSION_USER, name: null };

    renderPage('/dashboard?estado=comidas');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Hola$/);
  });
});
