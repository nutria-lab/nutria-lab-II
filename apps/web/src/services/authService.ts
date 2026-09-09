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

export type LoginErrorKind = 'invalidCredentials' | 'network';

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

function loginUrl() {
  const baseUrl = import.meta.env.VITE_API_URL;

  if (!baseUrl) {
    throw new LoginRequestError('network');
  }

  return `${baseUrl.replace(/\/+$/, '')}/auth/login`;
}

export const authService = {
  async login(credentials: LoginCredentials): Promise<AuthenticatedUser> {
    let response: Response;

    try {
      response = await fetch(loginUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: credentials.email, password: credentials.password }),
        credentials: 'include',
      });
    } catch (error) {
      if (error instanceof LoginRequestError) {
        throw error;
      }

      throw new LoginRequestError('network');
    }

    if (response.status === 401) {
      throw new LoginRequestError('invalidCredentials');
    }

    if (response.status !== 200) {
      throw new LoginRequestError('network');
    }

    try {
      const user: unknown = await response.json();

      if (!isAuthenticatedUser(user)) {
        throw new LoginRequestError('network');
      }

      return user;
    } catch {
      throw new LoginRequestError('network');
    }
  },
};
