import { SupabaseKpiCatalogClient } from './supabase-kpi-catalog-client';

const APPROVED_ORIGIN = 'https://rzlalzowistpiphmdqpp.supabase.co';

describe('SupabaseKpiCatalogClient credential boundary', () => {
  it('uses the exact approved HTTPS origin, disables redirects, and sends no request for a disallowed origin', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));

    expect(() => new SupabaseKpiCatalogClient({
      environment: 'prod', baseUrl: 'http://127.0.0.1:54321', approvedOrigin: APPROVED_ORIGIN,
      publishableKey: 'publishable-test-key', projectKey: 'project-test-key', fetchFn,
    })).toThrow('KPI_PUBLISH_CONFIGURATION_INVALID');
    expect(fetchFn).not.toHaveBeenCalled();

    const client = new SupabaseKpiCatalogClient({
      environment: 'prod', baseUrl: APPROVED_ORIGIN, approvedOrigin: APPROVED_ORIGIN,
      publishableKey: 'publishable-test-key', projectKey: 'project-test-key', fetchFn,
    });
    await expect(client.list()).resolves.toEqual([]);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/rzlalzowistpiphmdqpp\.supabase\.co\/rest\/v1\/kpi_catalog/),
      expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({ apikey: 'publishable-test-key', 'X-Project-Key': 'project-test-key' }) }),
    );
  });

  it.each([[409, 'CATALOG_CONFLICT'], [503, 'KPI_CATALOG_UNAVAILABLE']] as const)(
    'classifies catalog HTTP %s as %s without reading or logging its body',
    async (status, code) => {
      const fetchFn = jest.fn().mockResolvedValue(new Response('sensitive response body', { status }));
      const client = new SupabaseKpiCatalogClient({
        environment: 'prod', baseUrl: APPROVED_ORIGIN, approvedOrigin: APPROVED_ORIGIN,
        publishableKey: 'publishable-test-key', projectKey: 'project-test-key', fetchFn,
      });

      await expect(client.list()).rejects.toThrow(code);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it('classifies an aborted catalog request as unavailable without exposing transport details', async () => {
    const fetchFn: typeof fetch = jest.fn((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('secret transport details', 'AbortError')), { once: true });
    }));
    const client = new SupabaseKpiCatalogClient({
      environment: 'prod', baseUrl: APPROVED_ORIGIN, approvedOrigin: APPROVED_ORIGIN,
      publishableKey: 'publishable-test-key', projectKey: 'project-test-key', timeoutMs: 20, fetchFn,
    });

    await expect(client.list()).rejects.toThrow('KPI_CATALOG_UNAVAILABLE');
  });
});
