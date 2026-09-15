import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('apiClient env configuration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws a clear, actionable error during development when VITE_API_URL is missing', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_API_URL', '');

    await expect(import('./apiClient')).rejects.toThrow('VITE_API_URL no está configurada.');
  });

  it('uses the configured local backend URL during development', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_API_URL', 'https://nutria-lab-ii-api.vercel.app');

    const { apiClient } = await import('./apiClient');

    expect(apiClient.defaults.baseURL).toBe('https://nutria-lab-ii-api.vercel.app');
    expect(apiClient.defaults.withCredentials).toBe(true);
  });

  it('uses the same-site API prefix outside development', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_API_URL', '');

    const { apiClient } = await import('./apiClient');

    expect(apiClient.defaults.baseURL).toBe('/api');
    expect(apiClient.defaults.withCredentials).toBe(true);
  });
});
