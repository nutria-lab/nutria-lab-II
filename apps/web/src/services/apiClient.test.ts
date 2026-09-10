import {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient, setAuthFailureHandler } from './apiClient';

function failingAdapter(status: number) {
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const response: AxiosResponse = {
      data: {},
      status,
      statusText: 'Error',
      headers: {},
      config,
    };

    throw new AxiosError(
      `Request failed with status ${status}`,
      AxiosError.ERR_BAD_RESPONSE,
      config,
      undefined,
      response,
    );
  };
}

function networkErrorAdapter() {
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    throw new AxiosError(
      'Network Error',
      AxiosError.ERR_NETWORK,
      config,
    );
  };
}

afterEach(() => {
  setAuthFailureHandler(null);
});

describe('apiClient', () => {
  it('usa la URL de API configurada por ambiente', () => {
    expect(apiClient.defaults.baseURL).toBe(import.meta.env.VITE_API_URL);
  });

  it('configura Axios para enviar credenciales de sesión', () => {
    expect(apiClient.defaults.withCredentials).toBe(true);
  });

  it.each([401, 403])(
    'maneja una respuesta %s de una ruta protegida',
    async (status) => {
      const handler = vi.fn();
      setAuthFailureHandler(handler);

      await expect(
        apiClient.get('/protected', { adapter: failingAdapter(status) }),
      ).rejects.toBeInstanceOf(AxiosError);

      expect(handler).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['/auth/login', '/auth/logout'])(
    'no maneja automáticamente errores de %s',
    async (url) => {
      const handler = vi.fn();
      setAuthFailureHandler(handler);

      await expect(
        apiClient.post(url, {}, { adapter: failingAdapter(401) }),
      ).rejects.toBeInstanceOf(AxiosError);

      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('permite excluir explícitamente una request pública', async () => {
    const handler = vi.fn();
    setAuthFailureHandler(handler);

    await expect(
      apiClient.get('/public', {
        adapter: failingAdapter(401),
        skipAuthErrorHandling: true,
      }),
    ).rejects.toBeInstanceOf(AxiosError);

    expect(handler).not.toHaveBeenCalled();
  });

  it.each([400, 404, 422, 500])(
    'propaga un error HTTP %s sin tratarlo como error de autenticación',
    async (status) => {
      const handler = vi.fn();
      setAuthFailureHandler(handler);

      const request = apiClient.get('/resource', {
        adapter: failingAdapter(status),
      });

      await expect(request).rejects.toMatchObject({
        response: { status },
      });

      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('propaga errores de red sin limpiar la sesión', async () => {
    const handler = vi.fn();
    setAuthFailureHandler(handler);

    await expect(
      apiClient.get('/resource', { adapter: networkErrorAdapter() }),
    ).rejects.toMatchObject({
      code: AxiosError.ERR_NETWORK,
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('conserva el AxiosError original después de manejar un 401', async () => {
    setAuthFailureHandler(vi.fn());

    const request = apiClient.get('/protected', {
      adapter: failingAdapter(401),
    });

    await expect(request).rejects.toMatchObject({
      response: { status: 401 },
    });
  });

  it('deduplica el manejo de varios 401/403 simultáneos', async () => {
    let releaseHandler!: () => void;

    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseHandler = resolve;
        }),
    );

    setAuthFailureHandler(handler);

    const first = apiClient
      .get('/one', { adapter: failingAdapter(401) })
      .catch((error) => error);

    const second = apiClient
      .get('/two', { adapter: failingAdapter(403) })
      .catch((error) => error);

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });

    releaseHandler();

    await Promise.all([first, second]);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('auth failure handler resilience', () => {
  it('conserva el AxiosError original aunque falle el handler de sesión', async () => {
    setAuthFailureHandler(async () => {
      throw new Error('logout local failed');
    });

    const request = apiClient.get('/protected', {
      adapter: failingAdapter(401),
    });

    await expect(request).rejects.toMatchObject({
      response: { status: 401 },
    });
  });
});

describe('already handled auth errors', () => {
  it('no vuelve a manejar una request cuyo error de autenticación ya fue tratado', async () => {
    const handler = vi.fn();
    setAuthFailureHandler(handler);

    await expect(
      apiClient.get('/protected', {
        adapter: failingAdapter(401),
        authErrorHandled: true,
      }),
    ).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
