import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('apiClient env configuration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws a clear, actionable error when VITE_API_URL is missing', async () => {
    vi.stubEnv('VITE_API_URL', '');

    await expect(import('./apiClient')).rejects.toThrow('VITE_API_URL no está configurada.');
  });

  it('creates the client with the configured backend URL', async () => {
    vi.stubEnv('VITE_API_URL', 'https://nutria-lab-ii-api.vercel.app');

    const { apiClient } = await import('./apiClient');

    expect(apiClient.defaults.baseURL).toBe('https://nutria-lab-ii-api.vercel.app');
    expect(apiClient.defaults.withCredentials).toBe(true);
  });

  it('accepts a same-site relative API base URL for the deployed proxy', async () => {
    vi.stubEnv('VITE_API_URL', '/api');

    const { apiClient } = await import('./apiClient');

    expect(apiClient.defaults.baseURL).toBe('/api');
    expect(apiClient.defaults.withCredentials).toBe(true);
  });
});
