import {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from './apiClient';
import {
  authService,
  type LoginCredentials,
} from './authService';

const credentials: LoginCredentials = {
  email: 'persona@nutria.com',
  password: 'secreta',
};

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
    statusText: status === 204 ? 'No Content' : 'OK',
    headers: {},
    config,
  };
}

function rejectedResponse(config: InternalAxiosRequestConfig, status: number) {
  return new AxiosError(
    `Request failed with status ${status}`,
    AxiosError.ERR_BAD_RESPONSE,
    config,
    undefined,
    response(config, {}, status),
  );
}

afterEach(() => {
  apiClient.defaults.adapter = initialAdapter;
  vi.restoreAllMocks();
});

describe('authService', () => {
  it('uses the shared Axios client to submit only login credentials and normalizes the safe user', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => response(config, user));
    apiClient.defaults.adapter = adapter;

    await expect(authService.login(credentials)).resolves.toEqual(user);

    expect(adapter).toHaveBeenCalledTimes(1);
    const request = adapter.mock.calls[0][0] as InternalAxiosRequestConfig;
    expect(request.url).toBe('/auth/login');
    expect(request.method).toBe('post');
    expect(JSON.parse(request.data as string)).toEqual(credentials);
    expect(request.skipAuthErrorHandling).toBeUndefined();
  });

  it('gets the current user with the global authorization handler explicitly skipped', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => response(config, user));
    apiClient.defaults.adapter = adapter;

    await expect(authService.getCurrentUser()).resolves.toEqual(user);

    const request = adapter.mock.calls[0][0] as InternalAxiosRequestConfig;
    expect(request.url).toBe('/auth/me');
    expect(request.method).toBe('get');
    expect(request.skipAuthErrorHandling).toBe(true);
  });

  it('posts logout through the shared client without a request body and accepts 204', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => response(config, undefined, 204));
    apiClient.defaults.adapter = adapter;

    await expect(authService.logout()).resolves.toBeUndefined();

    const request = adapter.mock.calls[0][0] as InternalAxiosRequestConfig;
    expect(request.url).toBe('/auth/logout');
    expect(request.method).toBe('post');
    expect(request.data).toBeUndefined();
  });

  it('classifies a login 401 as invalid credentials without exposing the remote response', async () => {
    apiClient.defaults.adapter = async (config) => {
      throw rejectedResponse(config, 401);
    };

    await expect(authService.login(credentials)).rejects.toMatchObject({ kind: 'invalidCredentials' });
  });

  it('classifies a /auth/me 401 as an absent session and fails closed for malformed payloads', async () => {
    apiClient.defaults.adapter = async (config) => {
      throw rejectedResponse(config, 401);
    };

    await expect(authService.getCurrentUser()).rejects.toMatchObject({ kind: 'unauthenticated' });

    apiClient.defaults.adapter = async (config) => response(config, { id: user.id, email: user.email });

    await expect(authService.getCurrentUser()).rejects.toMatchObject({ kind: 'network' });
  });

  it('turns transport failures and malformed success bodies into recoverable errors without leaking details', async () => {
    apiClient.defaults.adapter = async (config) => {
      throw new AxiosError('connection refused', AxiosError.ERR_NETWORK, config);
    };

    await expect(authService.login(credentials)).rejects.toMatchObject({ kind: 'network' });

    apiClient.defaults.adapter = async (config) => response(config, { id: user.id, email: user.email });

    await expect(authService.login(credentials)).rejects.toMatchObject({ kind: 'network' });
  });
});
