import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient, setAuthFailureHandler } from '../../services/apiClient';
import { AuthProvider, useAuth } from './AuthProvider';

const user = {
  id: 'user-1',
  email: 'persona@nutria.com',
  name: 'Persona',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const initialAdapter = apiClient.defaults.adapter;

function response(config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse {
  return {
    data,
    status,
    statusText: 'OK',
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

function AuthProbe() {
  const { status, user: authenticatedUser } = useAuth();
  return <output data-testid="auth-state">{`${status}:${authenticatedUser?.email ?? ''}`}</output>;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderProvider(initialPath = '/goals') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <AuthProbe />
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  apiClient.defaults.adapter = initialAdapter;
  setAuthFailureHandler(null);
  vi.restoreAllMocks();
});

describe('AuthProvider session restoration', () => {
  it('starts initializing, requests /auth/me exactly once, then authenticates with only the normalized user in memory', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => response(config, user));
    apiClient.defaults.adapter = adapter;
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem');
    const sessionStorageSpy = vi.spyOn(Storage.prototype, 'getItem');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    renderProvider();

    expect(screen.getByTestId('auth-state')).toHaveTextContent('initializing:');
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent(`authenticated:${user.email}`));

    expect(adapter).toHaveBeenCalledTimes(1);
    const request = adapter.mock.calls[0][0] as InternalAxiosRequestConfig;
    expect(request.url).toBe('/auth/me');
    expect(request.skipAuthErrorHandling).toBe(true);
    expect(localStorageSpy).not.toHaveBeenCalled();
    expect(sessionStorageSpy).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('deduplicates session restoration when StrictMode replays effects in development', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => response(config, user));
    apiClient.defaults.adapter = adapter;

    render(
      <StrictMode>
        <MemoryRouter>
          <AuthProvider><AuthProbe /></AuthProvider>
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent(`authenticated:${user.email}`));
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it.each(['unauthenticated', 'network'] as const)('fails closed to anonymous when restoration is %s', async (kind) => {
    apiClient.defaults.adapter = async (config) => {
      if (kind === 'unauthenticated') {
        throw failedResponse(config, 401);
      }

      throw new AxiosError('offline', AxiosError.ERR_NETWORK, config);
    };

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('anonymous:'));
  });

  it('ignores a late restoration response after unmounting', async () => {
    let resolveRequest!: (value: AxiosResponse) => void;
    apiClient.defaults.adapter = (config) => new Promise<AxiosResponse>((resolve) => {
      resolveRequest = (value) => resolve(value);
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const view = renderProvider();
    expect(screen.getByTestId('auth-state')).toHaveTextContent('initializing:');

    view.unmount();
    resolveRequest(response({ url: '/auth/me' } as InternalAxiosRequestConfig, user));

    await Promise.resolve();
    await Promise.resolve();
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe('AuthProvider authorization failures', () => {
  it.each([401, 403])('invalidates locally and starts at most one best-effort logout for a protected %s', async (status) => {
    let protectedRequests = 0;
    let logoutRequests = 0;
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/me') {
        return response(config, user);
      }

      if (config.url === '/auth/logout') {
        logoutRequests += 1;
        return response(config, undefined, 204);
      }

      protectedRequests += 1;
      throw failedResponse(config, status);
    };

    renderProvider('/goals');
    await screen.findByText(`authenticated:${user.email}`);

    const request = apiClient.get('/protected').catch((error) => error);

    await expect(request).resolves.toBeInstanceOf(AxiosError);
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('anonymous:'));

    expect(protectedRequests).toBe(1);
    expect(logoutRequests).toBeLessThanOrEqual(1);
  });

  it('does not invalidate the restored session for /auth/me or explicit opt-out requests', async () => {
    let requests = 0;
    apiClient.defaults.adapter = async (config) => {
      requests += 1;
      if (config.url === '/auth/me' && requests === 1) {
        return response(config, user);
      }

      throw failedResponse(config, 401);
    };

    renderProvider();
    await screen.findByText(`authenticated:${user.email}`);

    await apiClient.get('/public', { skipAuthErrorHandling: true }).catch(() => undefined);

    expect(screen.getByTestId('auth-state')).toHaveTextContent(`authenticated:${user.email}`);
  });
});
