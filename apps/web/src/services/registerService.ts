import axios from 'axios';

import { apiClient } from './apiClient';

export type RegisterCredentials = {
  email: string;
  password: string;
  name?: string;
};

export type RegisteredUser = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RegisterErrorKind = 'emailAlreadyExists' | 'validation' | 'timeout' | 'network' | 'unexpected';

const REGISTRATION_TIMEOUT_MS = 10_000;

export class RegisterRequestError extends Error {
  constructor(public readonly kind: RegisterErrorKind) {
    super(kind);
    this.name = 'RegisterRequestError';
  }
}

function isRegisteredUser(value: unknown): value is RegisteredUser {
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

function registrationErrorKind(error: unknown): RegisterErrorKind {
  if (!axios.isAxiosError(error)) {
    return 'unexpected';
  }

  const status = error.response?.status;

  if (error.code === 'ECONNABORTED') {
    return 'timeout';
  }

  if (error.code === axios.AxiosError.ERR_CANCELED) {
    return 'network';
  }

  if (status === 409) {
    return 'emailAlreadyExists';
  }

  if (status === 400 || status === 422) {
    return 'validation';
  }

  return error.response ? 'unexpected' : 'network';
}

export const registerService = {
  async register(
    credentials: RegisterCredentials,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<RegisteredUser> {
    const name = credentials.name?.trim();
    const payload = {
      email: credentials.email.trim(),
      password: credentials.password,
      ...(name ? { name } : {}),
    };

    try {
      const response = await apiClient.post<RegisteredUser>(
        '/auth/register',
        payload,
        {
          skipAuthErrorHandling: true,
          timeout: REGISTRATION_TIMEOUT_MS,
          signal,
        },
      );

      if (!isRegisteredUser(response.data)) {
        throw new RegisterRequestError('unexpected');
      }

      return response.data;
    } catch (error) {
      if (error instanceof RegisterRequestError) {
        throw error;
      }

      throw new RegisterRequestError(registrationErrorKind(error));
    }
  },
};
