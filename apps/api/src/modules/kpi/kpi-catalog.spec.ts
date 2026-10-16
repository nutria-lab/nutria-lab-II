import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hasCompleteKpiCatalog, KPI_CATALOG } from './kpi-catalog';
import { registerKpiCatalog } from './kpi-catalog-registration';

type CatalogRequest = { method: string | undefined; url: URL; headers: IncomingMessage['headers']; body: string };

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

const APPROVED_DEV_ORIGIN = 'https://gapkrqfdshqbowdtldzc.supabase.co';

async function listen(handler: (request: CatalogRequest, response: ServerResponse) => Promise<void>): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    const captured = {
      method: request.method,
      url: new URL(request.url ?? '/', `http://${request.headers.host}`),
      headers: request.headers,
      body,
    };
    await handler(captured, response);
  });
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.closeAllConnections?.();
      server.close(error => error ? rejectClose(error) : resolveClose());
    }),
  };
}

/* The catalog is deliberately versioned and inert until a human runs kpi:catalog. */
describe('KPI publication catalog', () => {
  it('declares exactly the ten externally contracted definitions and never averages p95', () => {
    const definitions = KPI_CATALOG;

    expect(definitions).toHaveLength(10);
    expect(definitions.map(definition => [definition.id, definition.kind, definition.unit])).toEqual([
      ['operations_count', 'technical', '{request}'],
      ['error_rate', 'technical', '%'],
      ['latency_p95_ms', 'technical', 'ms'],
      ['health_status', 'health', '1'],
      ['last_success_age_seconds', 'technical', 's'],
      ['timeout_rate', 'technical', '%'],
      ['dependency_error_rate', 'technical', '%'],
      ['availability_rate', 'health', '%'],
      ['initial_plans_count', 'business', '{plan}'],
      ['manual_recipes_count', 'business', '{recipe}'],
    ]);
    for (const definition of definitions) {
      expect(definition.description.length).toBeGreaterThanOrEqual(5);
      expect(definition.description.length).toBeLessThanOrEqual(500);
      expect(definition.description).toMatch(/Argentina \[00:00, 21:00\)/);
      expect(definition.source).not.toHaveLength(0);
      expect(definition.justification).not.toHaveLength(0);
    }
    expect(definitions.find(definition => definition.id === 'latency_p95_ms')).not.toMatchObject({ aggregation: 'avg' });
  });

  it('requires the post-creation reconciliation read to contain exactly ten non-deprecated expected IDs and kind/unit pairs', () => {
    const reconciled = KPI_CATALOG.map(definition => ({ id: definition.id, kind: definition.kind, unit: definition.unit, deprecated_at: null }));

    expect(hasCompleteKpiCatalog(reconciled)).toBe(true);
    expect(hasCompleteKpiCatalog([...reconciled, { id: 'unknown', kind: 'technical', unit: '1', deprecated_at: null }])).toBe(false);
    expect(hasCompleteKpiCatalog(reconciled.map(entry => entry.id === 'health_status' ? { ...entry, deprecated_at: '2026-10-01T00:00:00Z' } : entry))).toBe(false);
    expect(hasCompleteKpiCatalog(reconciled.map(entry => entry.id === 'operations_count' ? { ...entry, unit: 'ms' } : entry))).toBe(false);
    expect(hasCompleteKpiCatalog(reconciled.filter(entry => entry.id !== 'timeout_rate'))).toBe(false);
  });

  it('validates identity, uses env/deprecated_at, and registers only missing definitions without a synthetic active field', async () => {
    const expected = new Map(KPI_CATALOG.map(definition => [definition.id, definition]));
    const initial = expected.get('operations_count')!;
    const catalog: Record<string, unknown>[] = [{
      id: initial.id, kind: initial.kind, unit: initial.unit, deprecated_at: null,
    }];
    const requests: CatalogRequest[] = [];
    const projectKey = 'catalog-project-fixture-secret';
    const publishableKey = 'catalog-publishable-fixture-secret';

    const server = await listen(async (request, response) => {
      requests.push(request);
      if (request.headers.apikey !== publishableKey || request.headers['x-project-key'] !== projectKey) {
        response.writeHead(401).end();
        return;
      }
      if (request.method === 'POST' && request.url.pathname === '/rest/v1/rpc/current_project') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify([{ env: 'dev' }]));
        return;
      }
      if (request.method === 'GET' && request.url.pathname === '/rest/v1/kpi_catalog') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(catalog));
        return;
      }
      if (request.method === 'POST' && request.url.pathname === '/rest/v1/kpi_catalog') {
        const definition = JSON.parse(request.body) as Record<string, unknown>;
        catalog.push({ ...definition, deprecated_at: null });
        response.writeHead(201).end();
        return;
      }
      response.writeHead(404).end();
    });

    const configuredOrigins: string[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(requestUrl);
      configuredOrigins.push(url.origin);
      if (url.origin !== APPROVED_DEV_ORIGIN) throw new Error('KPI test blocked an unapproved origin');
      const localUrl = new URL(`${url.pathname}${url.search}`, server.baseUrl);
      return fetch(localUrl, init);
    };
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await registerKpiCatalog({
        environment: 'dev',
        baseUrl: APPROVED_DEV_ORIGIN,
        approvedOrigin: APPROVED_DEV_ORIGIN,
        projectKey,
        publishableKey,
        fetchFn,
      });

      expect(requests[0]).toMatchObject({
        method: 'POST',
        url: expect.objectContaining({ pathname: '/rest/v1/rpc/current_project' }),
      });
      const reads = requests.filter(request => request.method === 'GET');
      expect(reads).toHaveLength(2);
      for (const request of reads) {
        expect(request.url.searchParams.get('select')?.split(',')).toEqual(expect.arrayContaining([
          'id', 'kind', 'unit', 'deprecated_at',
        ]));
      }

      const registrations = requests.filter(request => request.method === 'POST' && request.url.pathname === '/rest/v1/kpi_catalog');
      expect(registrations.map(request => (JSON.parse(request.body) as { id: string }).id).sort()).toEqual(
        KPI_CATALOG.filter(definition => definition.id !== initial.id).map(definition => definition.id).sort(),
      );
      for (const request of registrations) {
        const body = JSON.parse(request.body) as Record<string, unknown>;
        expect(body).not.toHaveProperty('active');
        expect(KPI_CATALOG.find(definition => definition.id === body.id)).toMatchObject({ kind: body.kind, unit: body.unit });
      }
      expect(catalog).toHaveLength(10);
      expect(configuredOrigins.length).toBeGreaterThan(0);
      expect(configuredOrigins.every(origin => origin === APPROVED_DEV_ORIGIN)).toBe(true);
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain(projectKey);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(projectKey);
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain(publishableKey);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(publishableKey);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await server.close();
    }
  });
});
