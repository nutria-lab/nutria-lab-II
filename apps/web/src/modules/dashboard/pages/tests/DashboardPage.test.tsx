import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

    expect(screen.getByText(NO_PLAN)).toBeVisible();
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
});

describe('DashboardPage greeting without a name', () => {
  it.each([true, false])('renders h1 "Hola" when the session name is null (DEV=%s)', (dev) => {
    vi.stubEnv('DEV', dev);
    mockAuth.user = { ...SESSION_USER, name: null };

    renderPage('/dashboard?estado=comidas');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Hola$/);
  });
});
