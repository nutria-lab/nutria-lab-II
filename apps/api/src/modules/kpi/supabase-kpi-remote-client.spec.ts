import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { SupabaseKpiRemoteClient } from './supabase-kpi-remote-client';

const PUBLISHABLE_KEY = 'sb_publishable_fixture_key';
const PROJECT_KEY = 'project_fixture_key';
const DATE = '2026-10-09';
const ENVIRONMENT = 'prod' as const;
const EXPECTED = [
  { kpi_id: 'availability_rate', date: DATE, env: ENVIRONMENT, value: 99.5, run_id: 'run-86' },
  { kpi_id: 'operations_count', date: DATE, env: ENVIRONMENT, value: 7, run_id: 'run-86' },
] as const;
const FROZEN_BYTES = Buffer.from(JSON.stringify(EXPECTED), 'utf8');

type CapturedRequest = {
  method: string | undefined;
  url: URL;
  headers: IncomingMessage['headers'];
  body: Buffer;
};

type LocalServer = {
  baseUrl: string;
  requests: CapturedRequest[];
  close(): Promise<void>;
};

async function startServer(handler: (request: CapturedRequest, response: ServerResponse) => unknown | Promise<unknown>): Promise<LocalServer> {
  const requests: CapturedRequest[] = [];
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    const captured = {
      method: request.method,
      url: new URL(request.url ?? '/', `http://${request.headers.host}`),
      headers: request.headers,
      body,
    };
    requests.push(captured);
    await handler(captured, response);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => closeServer(server),
  };
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    request.once('end', () => resolve(Buffer.concat(chunks)));
    request.once('error', reject);
  });
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function client(baseUrl: string, timeoutMs = 100): SupabaseKpiRemoteClient {
  return new SupabaseKpiRemoteClient({
    baseUrl,
    publishableKey: PUBLISHABLE_KEY,
    projectKey: PROJECT_KEY,
    timeoutMs,
  });
}

function expectAuthenticatedJson(request: CapturedRequest): void {
  expect(request.headers.apikey).toBe(PUBLISHABLE_KEY);
  expect(request.headers['x-project-key']).toBe(PROJECT_KEY);
  expect(request.headers['content-type']).toMatch(/^application\/json(?:;|$)/);
}

function withoutSecretLogging<T>(action: () => Promise<T>): Promise<T> {
  const spies = [jest.spyOn(console, 'debug'), jest.spyOn(console, 'info'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
  return action().finally(() => {
    const output = spies.flatMap(spy => spy.mock.calls.flat()).map(String).join('\n');
    expect(output).not.toContain(PUBLISHABLE_KEY);
    expect(output).not.toContain(PROJECT_KEY);
    spies.forEach(spy => spy.mockRestore());
  });
}

describe('SupabaseKpiRemoteClient POST', () => {
  it('posts the exact frozen UTF-8 bytes to the public measurement endpoint with the required auth headers', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(201).end();
    });
    try {
      await expect(withoutSecretLogging(() => client(server.baseUrl).post(FROZEN_BYTES))).resolves.toEqual({ kind: 'accepted', status: 201 });

      expect(server.requests).toHaveLength(1);
      const [request] = server.requests;
      expect(request.method).toBe('POST');
      expect(request.url.pathname).toBe('/rest/v1/measurement');
      expect(request.url.searchParams.get('on_conflict')).toBe('project_id,kpi_id,date,env');
      expect(request.headers.prefer).toBe('resolution=ignore-duplicates');
      expectAuthenticatedJson(request);
      expect(request.body.equals(FROZEN_BYTES)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it.each([
    [400, 'definitive'],
    [401, 'definitive'],
    [403, 'definitive'],
    [409, 'definitive'],
    [408, 'retryable'],
    [500, 'retryable'],
    [503, 'retryable'],
  ] as const)('classifies POST HTTP %i as %s without exposing credentials', async (status, kind) => {
    const server = await startServer((_request, response) => response.writeHead(status).end());
    try {
      await expect(withoutSecretLogging(() => client(server.baseUrl).post(FROZEN_BYTES))).resolves.toMatchObject({ kind, status });
    } finally {
      await server.close();
    }
  });

  it('preserves Retry-After seconds and HTTP-date hints on retryable POST responses', async () => {
    const seconds = await startServer((_request, response) => response.writeHead(429, { 'Retry-After': '120' }).end());
    try {
      await expect(client(seconds.baseUrl).post(FROZEN_BYTES)).resolves.toMatchObject({ kind: 'retryable', status: 429, retryAfterMs: 120_000 });
    } finally {
      await seconds.close();
    }

    const retryAt = new Date(Date.now() + 120_000).toUTCString();
    const date = await startServer((_request, response) => response.writeHead(503, { 'Retry-After': retryAt }).end());
    try {
      const outcome = await client(date.baseUrl).post(FROZEN_BYTES);
      expect(outcome).toMatchObject({ kind: 'retryable', status: 503 });
      expect((outcome as { retryAfterMs?: number }).retryAfterMs).toBeGreaterThan(100_000);
    } finally {
      await date.close();
    }
  });

  it('classifies network and timeout failures as retryable without a fabricated HTTP status', async () => {
    await expect(client('http://127.0.0.1:1').post(FROZEN_BYTES)).resolves.toMatchObject({ kind: 'retryable', status: null });

    const server = await startServer(() => {
      // Deliberately leave the request pending: AbortController must bound it.
    });
    try {
      await expect(client(server.baseUrl, 20).post(FROZEN_BYTES)).resolves.toMatchObject({ kind: 'retryable', status: null, errorKind: 'timeout' });
    } finally {
      await server.close();
    }
  });
});

describe('SupabaseKpiRemoteClient GET verification', () => {
  it('uses the same authentication and classifies an exact unordered measurement set as MATCH', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify([...EXPECTED].reverse()));
    });
    try {
      await expect(withoutSecretLogging(() => client(server.baseUrl).verify(ENVIRONMENT, DATE, EXPECTED))).resolves.toEqual({ kind: 'match', status: 200 });
      expect(server.requests).toHaveLength(1);
      const [request] = server.requests;
      expect(request.method).toBe('GET');
      expect(request.url.pathname).toBe('/rest/v1/measurement');
      expectAuthenticatedJson(request);
    } finally {
      await server.close();
    }
  });

  it('classifies no records as NOT_FOUND and any missing, extra, or value-mismatched record as VALUE_CONFLICT', async () => {
    const cases: readonly [string, unknown[], 'not_found' | 'conflict'][] = [
      ['no records', [], 'not_found'],
      ['missing record', [EXPECTED[0]], 'conflict'],
      ['value mismatch', [{ ...EXPECTED[0], value: 123 }, EXPECTED[1]], 'conflict'],
      ['extra record', [...EXPECTED, { ...EXPECTED[0], kpi_id: 'unknown_kpi' }], 'conflict'],
    ];

    for (const [_name, responseBody, kind] of cases) {
      const server = await startServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(responseBody));
      });
      try {
        await expect(client(server.baseUrl).verify(ENVIRONMENT, DATE, EXPECTED)).resolves.toEqual({ kind, status: 200 });
      } finally {
        await server.close();
      }
    }
  });

  it.each([
    ['HTTP error', 503, 'not-json'],
    ['invalid JSON', 200, '{broken'],
  ] as const)('returns VERIFY_UNAVAILABLE for GET %s', async (_label, status, body) => {
    const server = await startServer((_request, response) => response.writeHead(status, { 'Content-Type': 'application/json' }).end(body));
    try {
      await expect(client(server.baseUrl).verify(ENVIRONMENT, DATE, EXPECTED)).resolves.toEqual({ kind: 'unavailable', status });
    } finally {
      await server.close();
    }
  });

  it('returns VERIFY_UNAVAILABLE rather than NOT_FOUND when GET times out or cannot reach the service', async () => {
    await expect(client('http://127.0.0.1:1').verify(ENVIRONMENT, DATE, EXPECTED)).resolves.toEqual({ kind: 'unavailable', status: null });

    const server = await startServer(() => {
      // Deliberately leave the request pending.
    });
    try {
      await expect(client(server.baseUrl, 20).verify(ENVIRONMENT, DATE, EXPECTED)).resolves.toEqual({ kind: 'unavailable', status: null });
    } finally {
      await server.close();
    }
  });
});
