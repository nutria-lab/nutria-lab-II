import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardPage } from '@/modules/dashboard/pages/DashboardPage';
import type { AuthenticatedUser } from '@/services/authService';

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

function expectUnavailable(container: HTMLElement) {
  expect(screen.getAllByText(UNAVAILABLE)).toHaveLength(2);
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  expect(screen.queryByText(FIXTURE_TITLES)).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: NEXT_MEAL_TITLE })).not.toBeInTheDocument();
}

beforeEach(() => {
  mockAuth.user = { ...SESSION_USER };
});

afterEach(() => {
  cleanup();
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

  it.each([
    ['unknown', '/dashboard?estado=no-existe'],
    ['empty', '/dashboard?estado='],
    ['missing', '/dashboard'],
  ])('a %s ?estado shows the unavailable state, same as production', (_label, entry) => {
    const { container } = renderPage(entry);

    expectUnavailable(container);
    expect(screen.getByRole('heading', { level: 1, name: 'Hola, María' })).toBeVisible();
  });
});

describe('DashboardPage outside development', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false);
  });

  it('ignores ?estado=comidas and shows the unavailable state with the real name', () => {
    const { container } = renderPage('/dashboard?estado=comidas');

    expectUnavailable(container);
    expect(screen.getByRole('heading', { level: 1, name: 'Hola, María' })).toBeVisible();
  });

  it('without ?estado, both "Progreso de la semana" and "Comidas de hoy" say "No disponible todavía" and nothing is busy (§16)', () => {
    renderPage('/dashboard');

    const progress = screen.getByRole('region', { name: 'Progreso de la semana' });
    expect(within(progress).getByText(UNAVAILABLE)).toBeVisible();
    expect(progress.querySelector('[aria-busy="true"]')).toBeNull();
    const meals = screen.getByRole('region', { name: 'Comidas de hoy' });
    expect(within(meals).getByText(UNAVAILABLE)).toBeVisible();
    expect(meals.querySelector('[aria-busy="true"]')).toBeNull();
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
