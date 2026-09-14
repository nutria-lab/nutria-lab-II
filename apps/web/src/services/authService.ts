import axios from 'axios';

import { apiClient } from './apiClient';

const AUTH_REQUEST_TIMEOUT_MS = 10_000;

export type LoginCredentials = {
  email: string;
  password: string;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LoginErrorKind = 'invalidCredentials' | 'network' | 'unauthenticated';

export class LoginRequestError extends Error {
  constructor(public readonly kind: LoginErrorKind) {
    super(kind);
    this.name = 'LoginRequestError';
  }
}

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const user = value as Record<string, unknown>;

  return typeof user.id === 'string'
    && typeof user.email === 'string'
    && (typeof user.name === 'string' || user.name === null)
    && typeof user.createdAt === 'string'
    && typeof user.updatedAt === 'string';
}

async function requestUser(
  request: Promise<{ data: unknown }>,
  { unauthenticated = false }: { unauthenticated?: boolean } = {},
) {
  try {
    const { data } = await request;
    if (!isAuthenticatedUser(data)) throw new LoginRequestError('network');
    return data;
  } catch (error) {
    if (error instanceof LoginRequestError) throw error;
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      throw new LoginRequestError(unauthenticated ? 'unauthenticated' : 'invalidCredentials');
    }
    throw new LoginRequestError('network');
  }
}

export const authService = {
  async login(credentials: LoginCredentials): Promise<AuthenticatedUser> {
    return requestUser(apiClient.post('/auth/login', credentials, {
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    }));
  },
  async getCurrentUser(): Promise<AuthenticatedUser> {
    return requestUser(
      apiClient.get('/auth/me', {
        skipAuthErrorHandling: true,
        timeout: AUTH_REQUEST_TIMEOUT_MS,
      }),
      { unauthenticated: true },
    );
  },
  async logout(): Promise<void> {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Local logout is authoritative.
    }
  },
};
