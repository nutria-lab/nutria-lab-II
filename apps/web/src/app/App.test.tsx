import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../services/apiClient';
import { App } from './App';

vi.mock('../services/apiClient', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

const AUTH_FLAG_KEY = 'nutria:isAuthenticated';

const loginResponse = {
  id: 'user-1',
  email: 'persona@nutria.com',
  name: 'Persona',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const registrationResponse = {
  id: 'user-9',
  email: 'persona@nutria.com',
  name: 'Persona',
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z',
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function LeaveLoginButton() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/dashboard')}>Salir de login</button>;
}

function renderAtLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <App />
      <LocationProbe />
      <LeaveLoginButton />
    </MemoryRouter>,
  );
}

function renderAtRegistration() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

async function completeValidCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/correo/i), 'persona@nutria.com');
  await user.type(screen.getByLabelText(/^contraseña$/i), 'secreta');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  localStorage.removeItem(AUTH_FLAG_KEY);
});

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'http://api.nutria.test');
});

describe('App login integration', () => {
  it('registers publicly and navigates to /login after the real API confirms account creation', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockResolvedValue({ data: registrationResponse } as never);
    renderAtRegistration();

    expect(screen.getByRole('heading', { name: /creá tu cuenta/i })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Goals' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/register');

    await user.type(screen.getByLabelText(/^nombre$/i), 'Persona');
    await user.type(screen.getByLabelText(/correo electrónico/i), 'persona@nutria.com');
    await user.type(screen.getByLabelText(/^contraseña$/i), 'secreta');
    await user.type(screen.getByLabelText(/confirmá tu contraseña/i), 'secreta');
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/auth/register',
      {
        name: 'Persona',
        email: 'persona@nutria.com',
        password: 'secreta',
      },
      expect.objectContaining({
        skipAuthErrorHandling: true,
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    ));
    expect(vi.mocked(apiClient.post).mock.calls[0]?.[1]).not.toHaveProperty('confirmPassword');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
    expect(screen.getByRole('heading', { name: /iniciá sesión/i })).toBeVisible();
  });

  it('renders LoginPage publicly at /login without the application sidebar', () => {
    renderAtLogin();

    expect(screen.getByRole('heading', { name: /iniciá sesión/i })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Goals' })).not.toBeInTheDocument();
  });

  it('submits once while loading and navigates to /goals after a successful login', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(loginResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAtLogin();

    await completeValidCredentials(user);
    fireEvent.submit(document.querySelector('form')!);
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/goals'));
  });

  it('keeps the submit lock while credentials change during a pending login request', async () => {
    const user = userEvent.setup();
    let resolveLogin: (response: Response) => void;
    const pendingLogin = new Promise<Response>((resolve) => {
      resolveLogin = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(pendingLogin);
    vi.stubGlobal('fetch', fetchMock);
    renderAtLogin();

    await completeValidCredentials(user);
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Iniciando sesión...' })).toBeDisabled();

    await user.type(screen.getByLabelText(/correo/i), '+');

    expect(screen.getByRole('button', { name: 'Iniciando sesión...' })).toBeDisabled();
    fireEvent.submit(document.querySelector('form')!);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveLogin!(new Response(JSON.stringify(loginResponse), { status: 200 }));
  });

  it('revalidates edited credentials instead of retrying an invalid login after a pending request fails', async () => {
    const user = userEvent.setup();
    let rejectLogin: (reason?: unknown) => void;
    const pendingLogin = new Promise<Response>((_resolve, reject) => {
      rejectLogin = reject;
    });
    const fetchMock = vi.fn().mockReturnValue(pendingLogin);
    vi.stubGlobal('fetch', fetchMock);
    renderAtLogin();

    await completeValidCredentials(user);
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const email = screen.getByLabelText(/correo/i);
    await user.clear(email);
    await user.type(email, 'persona@nutria');
    await act(async () => {
      rejectLogin!(new TypeError('Network request failed'));
      await pendingLogin.catch(() => undefined);
    });

    await screen.findByRole('button', { name: /reintentar/i });
    await user.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveFocus();
    expect(screen.getAllByText('Ingresá un correo electrónico válido.').length).toBeGreaterThan(0);
  });

  it('keeps the login route and presents only the generic credentials error for a 401', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    renderAtLogin();

    await completeValidCredentials(user);
    fireEvent.submit(document.querySelector('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('El correo o la contraseña no son correctos.');
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
    expect(screen.queryByText(/credenciales incorrectas/i)).not.toBeInTheDocument();
  });

  it('presents a recoverable network failure and lets the person retry successfully', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify(loginResponse), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderAtLogin();

    await completeValidCredentials(user);
    fireEvent.submit(document.querySelector('form')!);

    expect(await screen.findByRole('alert')).not.toHaveTextContent('El correo o la contraseña no son correctos.');
    const retry = screen.getByRole('button', { name: /reintentar/i });
    expect(retry).toBeEnabled();

    await user.click(retry);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/goals'));
  });

  it('does not navigate after a pending login resolves once the person has left /login', async () => {
    const user = userEvent.setup();
    let resolveLogin: (response: Response) => void;
    const pendingLogin = new Promise<Response>((resolve) => {
      resolveLogin = resolve;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pendingLogin));
    // /dashboard ahora vive detrás de PrivateRoute; se simula una sesión
    // previa ya válida para poder navegar ahí manualmente, como hace este test.
    localStorage.setItem(AUTH_FLAG_KEY, 'true');
    renderAtLogin();

    await completeValidCredentials(user);
    fireEvent.submit(document.querySelector('form')!);
    await user.click(screen.getByRole('button', { name: 'Salir de login' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard');
    await act(async () => {
      resolveLogin!(new Response(JSON.stringify(loginResponse), { status: 200 }));
      await pendingLogin;
    });

    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard');
  });
});
