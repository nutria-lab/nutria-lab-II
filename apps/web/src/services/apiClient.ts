import axios, { type AxiosError } from 'axios';

declare module 'axios' {
  interface AxiosRequestConfig {
    skipAuthErrorHandling?: boolean;
    authErrorHandled?: boolean;
  }
}

type AuthFailureHandler = () => void | Promise<void>;

let authFailureHandler: AuthFailureHandler | null = null;
let authFailureInFlight: Promise<void> | null = null;

const EXCLUDED_AUTH_PATHS = new Set([
  '/auth/login',
  '/auth/logout',
]);

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

export function setAuthFailureHandler(handler: AuthFailureHandler | null) {
  authFailureHandler = handler;

  if (!handler) {
    authFailureInFlight = null;
  }
}

function isExcludedAuthPath(url?: string) {
  if (!url) {
    return false;
  }

  try {
    const pathname = new URL(url, 'http://localhost').pathname.replace(/\/+$/, '');
    return EXCLUDED_AUTH_PATHS.has(pathname);
  } catch {
    return false;
  }
}

function shouldHandleAuthError(error: AxiosError) {
  const status = error.response?.status;
  const config = error.config;

  if (status !== 401 && status !== 403) {
    return false;
  }

  if (!config) {
    return false;
  }

  if (config.skipAuthErrorHandling || config.authErrorHandled) {
    return false;
  }

  return !isExcludedAuthPath(config.url);
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || !shouldHandleAuthError(error)) {
      return Promise.reject(error);
    }

    if (error.config) {
      error.config.authErrorHandled = true;
    }

    if (authFailureHandler) {
      if (!authFailureInFlight) {
        authFailureInFlight = Promise.resolve()
          .then(() => authFailureHandler?.())
          .catch(() => undefined)
          .then(() => undefined)
          .finally(() => {
            authFailureInFlight = null;
          });
      }

      await authFailureInFlight;
    }

    return Promise.reject(error);
  },
);
