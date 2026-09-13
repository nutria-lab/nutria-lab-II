import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient, setAuthFailureHandler } from '../services/apiClient';
import { App } from './App';

const authenticatedUser = {
  id: 'user-1',
  email: 'persona@nutria.com',
  name: 'Persona',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const registeredUser = {
  id: 'user-9',
  email: 'persona@nutria.com',
  name: 'Persona',
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z',
};

const initialAdapter = apiClient.defaults.adapter;

function response(config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse {
  return {
    data,
    status,
    statusText: status === 204 ? 'No Content' : 'OK',
    headers: {},
    config,
  };
}

function failedResponse(config: InternalAxiosRequestConfig, status: number) {
  return new AxiosError(
    `Request failed with status ${status}`,
    AxiosError.ERR_BAD_RESPONSE,
    config,
    undefined,
    response(config, {}, status),
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderApp(
  initialEntry: string | { pathname: string; state?: unknown },
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

async function completeValidCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/correo/i), authenticatedUser.email);
  await user.type(screen.getByLabelText(/^contraseña$/i), 'secreta');
}

afterEach(() => {
  cleanup();
  apiClient.defaults.adapter = initialAdapter;
  setAuthFailureHandler(null);
  vi.restoreAllMocks();
});

describe('App authentication routes', () => {
  it('renders only an accessible session-checking status while initial identity restoration is unresolved', () => {
    apiClient.defaults.adapter = () => new Promise<AxiosResponse>(() => undefined);

    renderApp('/goals');

    expect(screen.getByRole('status', { name: /comprobando sesión/i })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Goals' })).not.toBeInTheDocument();
    expect(screen.queryByText(/objetivos nutricionales/i)).not.toBeInTheDocument();
  });

  it('redirects an anonymous visitor from a protected route to /login without showing the app shell', async () => {
    apiClient.defaults.adapter = async (config) => {
      throw failedResponse(config, 401);
    };

    renderApp('/dashboard');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
    expect(screen.getByRole('heading', { name: /iniciá sesión/i })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Goals' })).not.toBeInTheDocument();
  });

  it('bounds session restoration and fails closed to login when that request times out', async () => {
    let restorationTimeout: number | undefined;
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/me') {
        restorationTimeout = config.timeout;
        throw new AxiosError('session restoration timed out', 'ECONNABORTED', config);
      }

      throw new Error(`Unexpected request: ${config.url}`);
    };

    renderApp('/dashboard');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
    expect(restorationTimeout).toBeGreaterThan(0);
    expect(restorationTimeout).toBeLessThanOrEqual(10_000);
    expect(screen.getByRole('heading', { name: /iniciá sesión/i })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Goals' })).not.toBeInTheDocument();
  });

  it('allows an authenticated visitor to reach a protected route', async () => {
    apiClient.defaults.adapter = async (config) => response(config, authenticatedUser);

    renderApp('/dashboard');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Goals' })).toBeVisible();
  });

  it('keeps login public for an anonymous person and navigates once to the protected default after login', async () => {
    const user = userEvent.setup();
    let currentUserRequests = 0;
    let loginRequests = 0;
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/me') {
        currentUserRequests += 1;
        throw failedResponse(config, 401);
      }

      if (config.url === '/auth/login') {
        loginRequests += 1;
        return response(config, authenticatedUser);
      }

      throw new Error(`Unexpected request: ${config.url}`);
    };

    renderApp('/login');
    await screen.findByRole('heading', { name: /iniciá sesión/i });
    await completeValidCredentials(user);
    fireEvent.submit(document.querySelector('form')!);
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/goals'));
    expect(currentUserRequests).toBe(1);
    expect(loginRequests).toBe(1);
  });

  it('keeps the NUT-8 registration route public after anonymous session restoration', async () => {
    let currentUserRequests = 0;
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/me') {
        currentUserRequests += 1;
        throw failedResponse(config, 401);
      }

      throw new Error(`Unexpected request: ${config.url}`);
    };

    renderApp('/register');

    expect(await screen.findByRole('heading', { name: /creá tu cuenta/i })).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/register');
    expect(screen.queryByRole('link', { name: 'Goals' })).not.toBeInTheDocument();
    expect(currentUserRequests).toBe(1);
  });

  it('registers publicly and navigates to /login after the real API confirms account creation', async () => {
    const user = userEvent.setup();
    let registrationConfig: InternalAxiosRequestConfig | undefined;
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/me') {
        throw failedResponse(config, 401);
      }

      if (config.url === '/auth/register') {
        registrationConfig = config;
        return response(config, registeredUser);
      }

      throw new Error(`Unexpected request: ${config.url}`);
    };

    renderApp('/register');
    expect(await screen.findByRole('heading', { name: /creá tu cuenta/i })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Goals' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/register');

    await user.type(screen.getByLabelText(/^nombre$/i), 'Persona');
    await user.type(screen.getByLabelText(/correo electrónico/i), 'persona@nutria.com');
    await user.type(screen.getByLabelText(/^contraseña$/i), 'secreta');
    await user.type(screen.getByLabelText(/confirmá tu contraseña/i), 'secreta');
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(registrationConfig).toBeDefined());
    expect(registrationConfig?.skipAuthErrorHandling).toBe(true);
    expect(registrationConfig?.timeout).toBe(10_000);
    expect(registrationConfig?.signal).toBeInstanceOf(AbortSignal);
    const requestData = registrationConfig?.data;
    expect(typeof requestData === 'string' ? JSON.parse(requestData) : requestData).toEqual({
      name: 'Persona',
      email: 'persona@nutria.com',
      password: 'secreta',
    });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
    expect(screen.getByRole('heading', { name: /iniciá sesión/i })).toBeVisible();
  });

  it('returns to an internal protected destination after login but rejects an external destination', async () => {
    const user = userEvent.setup();
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/me') {
        throw failedResponse(config, 401);
      }

      return response(config, authenticatedUser);
    };

    const internalDestination = renderApp({ pathname: '/login', state: { from: { pathname: '/dashboard' } } });
    await screen.findByRole('heading', { name: /iniciá sesión/i });
    await completeValidCredentials(user);
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/dashboard'));

    internalDestination.unmount();

    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/me') {
        throw failedResponse(config, 401);
      }

      return response(config, authenticatedUser);
    };

    renderApp({ pathname: '/login', state: { from: { pathname: '//evil.test' } } });
    const loginHeading = await screen.findByRole('heading', { name: /iniciá sesión/i });
    await completeValidCredentials(user);
    fireEvent.submit(loginHeading.closest('main')!.querySelector('form')!);

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/goals'));
  });

  it('keeps the login route and existing generic message when the server rejects credentials', async () => {
    const user = userEvent.setup();
    apiClient.defaults.adapter = async (config) => {
      throw failedResponse(config, 401);
    };

    renderApp('/login');
    await screen.findByRole('heading', { name: /iniciá sesión/i });
    await completeValidCredentials(user);
    fireEvent.submit(document.querySelector('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('El correo o la contraseña no son correctos.');
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });
});

describe('App logout', () => {
  it('offers an accessible logout control, clears local access first, and redirects even when remote logout fails', async () => {
    const user = userEvent.setup();
    let logoutRequests = 0;
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/me') {
        return response(config, authenticatedUser);
      }

      if (config.url === '/auth/logout') {
        logoutRequests += 1;
        throw failedResponse(config, 401);
      }

      throw new Error(`Unexpected request: ${config.url}`);
    };

    renderApp('/goals');
    const logout = await screen.findByRole('button', { name: 'Cerrar sesión' });
    expect(screen.getByRole('button', { name: 'Cerrar sesión en móvil' })).toBeVisible();
    await user.click(logout);

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
    expect(logoutRequests).toBe(1);
    expect(screen.queryByRole('link', { name: 'Goals' })).not.toBeInTheDocument();
  });
});
