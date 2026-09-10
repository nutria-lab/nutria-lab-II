import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authService, type LoginCredentials } from './authService';

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'http://api.nutria.test');
});

describe('authService.login', () => {
  it('posts only credentials with cookie credentials and returns the parsed user', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(user), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(authService.login(credentials)).resolves.toEqual(user);

    expect(fetchMock).toHaveBeenCalledWith('http://api.nutria.test/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: credentials.email, password: credentials.password }),
      credentials: 'include',
    });
  });

  it('classifies a 401 differently from a network failure without exposing response detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('Credenciales incorrectas', { status: 401 })));

    await expect(authService.login(credentials)).rejects.toMatchObject({ kind: 'invalidCredentials' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Network request failed')));

    await expect(authService.login(credentials)).rejects.toMatchObject({ kind: 'network' });
  });

  it('rejects a malformed successful response as a recoverable failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'user-1', email: credentials.email }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));

    await expect(authService.login(credentials)).rejects.toMatchObject({ kind: 'network' });
  });

  it.each([201, 202])('rejects a shape-valid HTTP %i response as a recoverable failure', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(user), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));

    await expect(authService.login(credentials)).rejects.toMatchObject({ kind: 'network' });
  });
});
