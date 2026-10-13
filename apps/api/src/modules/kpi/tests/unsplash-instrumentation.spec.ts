// NUT-85 T4 — Unsplash instrumentado en el punto de ejecución (C1, C2; design D9). fetch mockeado, sin red.
// Contrato fijado:
// - new UnsplashService(config, instrumentation?) — 2º parámetro @Optional() @Inject(DEPENDENCY_INSTRUMENTATION), por defecto NOOP.
// - Búsqueda: sólo el intercambio de red (fetch + status + json) va envuelto con run('unsplash_search', ...):
//   200 + JSON leído ⇒ success (incluso 0 resultados); status ≠ 200 ⇒ error; abort ⇒ timeout; JSON inválido ⇒ error.
// - trackDownload: sólo el fetch va envuelto con run('unsplash_download', ...): ok ⇒ success; no ok ⇒ error; abort ⇒ timeout.
// - Sin key, cuota agotada o URL de tracking inválida ⇒ no hay intento ⇒ el wrapper no se llama.
// - El contrato de negocio no cambia (null / FAILED, nunca lanza).
import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UNSPLASH_TIMEOUT_MS, UnsplashService } from '../../unsplash/unsplash.service';
import {
  hangingFetch,
  pendingPersistedImage,
  unsplashPhoto,
  unsplashResponse,
  unsplashSearchBody,
} from '../../unsplash/unsplash-search.fixture';
import type { KpiConfig } from '../config/kpi-config';
import { KpiDependencyInstrumentation } from '../dependencies/dependency-instrumentation';
import type { DependencyCloseEvent, DependencyPendingEvent, KpiEventWriter } from '../events/kpi-event-writer';
import { runWithKpiRequestContext } from '../http/kpi-request-context';

const ACCESS_KEY = 'unsplash-access-key-SECRET';
const ENABLED_DEV: KpiConfig = { enabled: true, environment: 'dev', disabledReason: null };

function configWith(key: string | undefined) {
  return { get: jest.fn((name: string) => (name === 'UNSPLASH_ACCESS_KEY' ? key : undefined)) } as unknown as ConfigService;
}

function fakeWriter(mode: 'ok' | 'reject' = 'ok') {
  const pending: DependencyPendingEvent[] = [];
  const closed: DependencyCloseEvent[] = [];
  const act = <E>(list: E[]) => async (event: E) => {
    list.push(event);
    if (mode === 'reject') throw new Error('kpi db down');
  };
  const writer: KpiEventWriter = {
    insertHttpPending: jest.fn(async () => undefined),
    closeHttp: jest.fn(async () => undefined),
    insertDependencyPending: jest.fn(act(pending)),
    closeDependency: jest.fn(act(closed)),
    drain: jest.fn(async () => undefined),
    inFlightCount: () => 0,
  };
  const rows = () => pending.map(p => ({ ...p, outcome: 'pending', ...closed.find(c => c.id === p.id) }));
  return { writer, rows };
}

function setup(key: string | undefined = ACCESS_KEY, mode: 'ok' | 'reject' = 'ok') {
  const fake = fakeWriter(mode);
  const instrumentation = new KpiDependencyInstrumentation(ENABLED_DEV, fake.writer);
  const runSpy = jest.spyOn(instrumentation, 'run');
  const service = new UnsplashService(configWith(key), instrumentation);
  return { ...fake, service, runSpy };
}

function mockFetch(implementation: (url: string, options?: RequestInit) => Promise<unknown>) {
  const fetchMock = jest.fn((url: unknown, options?: RequestInit) => implementation(String(url), options));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const inRequest = <T>(fn: () => Promise<T>, operationId = randomUUID()) =>
  runWithKpiRequestContext({ operationId, attempts: new Map() }, fn);

function buildDay(titles: string[]) {
  return {
    day: 'MONDAY',
    date: '2026-09-14',
    meals: titles.map(title => ({
      mealType: 'LUNCH',
      title,
      nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Almuerzo' },
      recipe: { title, description: 'd', prepMinutes: 10, cookMinutes: 15, ingredients: [{ name: 'X', quantity: 1, unit: 'g' }], instructions: ['p'] },
    })),
  } as any;
}

const originalFetch = global.fetch;

beforeEach(() => {
  for (const method of ['log', 'error', 'warn', 'debug', 'verbose'] as const) {
    jest.spyOn(Logger.prototype, method).mockImplementation(() => undefined);
    jest.spyOn(Logger, method).mockImplementation(() => undefined);
  }
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('UnsplashService búsqueda + instrumentación (C1, C2)', () => {
  it("search 200 con candidato ⇒ success con 'unsplash_search', mismo resultado de negocio", async () => {
    mockFetch(async () => unsplashResponse(unsplashSearchBody([unsplashPhoto()])));
    const { service, rows, runSpy } = setup();

    const image = await inRequest(() => service.searchAndSelectCandidate('Ensalada de Quinoa'));

    expect(image).toEqual(expect.objectContaining({ provider: 'UNSPLASH', providerPhotoId: 'eOLpJytrbsQ' }));
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy.mock.calls[0][0]).toBe('unsplash_search');
    expect(rows()).toEqual([expect.objectContaining({ dependency: 'unsplash_search', attempt: 1, outcome: 'success' })]);
  });

  it('search 200 sin resultados ⇒ success (respuesta útil) y el servicio devuelve null', async () => {
    mockFetch(async () => unsplashResponse(unsplashSearchBody([])));
    const { service, rows } = setup();

    await expect(inRequest(() => service.searchAndSelectCandidate('Nada'))).resolves.toBeNull();

    expect(rows()).toEqual([expect.objectContaining({ dependency: 'unsplash_search', outcome: 'success' })]);
  });

  it.each([403, 500])("search %i ⇒ error, el servicio devuelve null", async status => {
    mockFetch(async () => unsplashResponse({ errors: ['x'] }, { status }));
    const { service, rows } = setup();

    await expect(inRequest(() => service.searchAndSelectCandidate('Ensalada'))).resolves.toBeNull();

    expect(rows()).toEqual([expect.objectContaining({ dependency: 'unsplash_search', outcome: 'error' })]);
  });

  it('search con JSON inválido ⇒ error', async () => {
    mockFetch(async () => unsplashResponse('<html>no json</html>'));
    const { service, rows } = setup();

    await expect(inRequest(() => service.searchAndSelectCandidate('Ensalada'))).resolves.toBeNull();

    expect(rows()).toEqual([expect.objectContaining({ outcome: 'error' })]);
  });

  it('search con error de red ⇒ error', async () => {
    mockFetch(async () => Promise.reject(new TypeError('fetch failed')));
    const { service, rows } = setup();

    await expect(inRequest(() => service.searchAndSelectCandidate('Ensalada'))).resolves.toBeNull();

    expect(rows()).toEqual([expect.objectContaining({ outcome: 'error' })]);
  });

  it('search abortado por el timeout propio ⇒ timeout', async () => {
    jest.useFakeTimers();
    global.fetch = hangingFetch() as unknown as typeof fetch;
    const { service, rows } = setup();

    const pending = inRequest(() => service.searchAndSelectCandidate('Ensalada'));
    await jest.advanceTimersByTimeAsync(UNSPLASH_TIMEOUT_MS + 1000);

    await expect(pending).resolves.toBeNull();
    expect(rows()).toEqual([expect.objectContaining({ dependency: 'unsplash_search', outcome: 'timeout' })]);
  });

  it('timeout mientras se lee el body (json) ⇒ timeout: la lectura está dentro del intento', async () => {
    jest.useFakeTimers();
    mockFetch(async (_url, options) => ({
      status: 200,
      ok: true,
      headers: new Headers(),
      json: () => hangingFetch()('', { signal: options?.signal ?? undefined }),
    }));
    const { service, rows } = setup();

    const pending = inRequest(() => service.searchAndSelectCandidate('Ensalada'));
    await jest.advanceTimersByTimeAsync(UNSPLASH_TIMEOUT_MS + 1000);

    await expect(pending).resolves.toBeNull();
    expect(rows()).toEqual([expect.objectContaining({ outcome: 'timeout' })]);
  });

  it('sin key ⇒ no hay intento: el wrapper no se llama y no hay filas', async () => {
    const fetchMock = mockFetch(async () => unsplashResponse(unsplashSearchBody([])));
    const { service, runSpy, writer } = setup(''); // '' y no undefined: el parámetro por defecto reemplazaría undefined por ACCESS_KEY

    await expect(inRequest(() => service.searchAndSelectCandidate('Ensalada'))).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
    expect(writer.insertDependencyPending).not.toHaveBeenCalled();
  });

  it('cuota agotada ⇒ la 2ª búsqueda no es un intento (sólo 1 fila)', async () => {
    const fetchMock = mockFetch(async () => unsplashResponse(unsplashSearchBody([]), { remaining: 0 }));
    const { service, runSpy, rows } = setup();

    await inRequest(async () => {
      await service.searchAndSelectCandidate('Ensalada');
      await service.searchAndSelectCandidate('Sopa');
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(1);
  });

  it('searchAndSelectImages con 4 títulos ⇒ 4 attempts únicos en la misma request (concurrencia 3)', async () => {
    mockFetch(async () => unsplashResponse(unsplashSearchBody([unsplashPhoto()])));
    const { service, rows } = setup();
    const operationId = randomUUID();

    await inRequest(() => service.searchAndSelectImages([buildDay(['Ensalada', 'Sopa', 'Guiso', 'Tarta'])]), operationId);

    expect(rows()).toHaveLength(4);
    expect(rows().every(r => r.operationId === operationId && r.dependency === 'unsplash_search')).toBe(true);
    expect(rows().map(r => r.attempt).sort()).toEqual([1, 2, 3, 4]);
  });

  it('las filas no contienen URL, query, título ni access_key', async () => {
    mockFetch(async () => unsplashResponse(unsplashSearchBody([unsplashPhoto()])));
    const { service, writer } = setup();

    await inRequest(() => service.searchAndSelectCandidate('Ensalada de Quinoa'));

    const serialized = JSON.stringify([
      ...(writer.insertDependencyPending as jest.Mock).mock.calls,
      ...(writer.closeDependency as jest.Mock).mock.calls,
    ]);
    expect(serialized).not.toMatch(/https?:|unsplash\.com|quinoa|ensalada|food recipe|SECRET|access|Client-ID/i);
  });

  it('un escritor que falla no cambia el resultado de la búsqueda', async () => {
    mockFetch(async () => unsplashResponse(unsplashSearchBody([unsplashPhoto()])));
    const { service } = setup(ACCESS_KEY, 'reject');

    const image = await inRequest(() => service.searchAndSelectCandidate('Ensalada'));

    expect(image).toEqual(expect.objectContaining({ providerPhotoId: 'eOLpJytrbsQ' }));
  });
});

describe('UnsplashService.trackDownload + instrumentación (C1, C2)', () => {
  it("ok ⇒ success con 'unsplash_download' y tracking SUCCEEDED", async () => {
    mockFetch(async () => new Response('{}', { status: 200 }));
    const { service, rows, runSpy } = setup();

    const result = await inRequest(() => service.trackDownload(pendingPersistedImage()));

    expect(result.tracking.status).toBe('SUCCEEDED');
    expect(runSpy.mock.calls.map(([dependency]) => dependency)).toEqual(['unsplash_download']);
    expect(rows()).toEqual([expect.objectContaining({ dependency: 'unsplash_download', attempt: 1, outcome: 'success' })]);
  });

  it('no ok ⇒ error y tracking FAILED', async () => {
    mockFetch(async () => new Response('{}', { status: 500 }));
    const { service, rows } = setup();

    const result = await inRequest(() => service.trackDownload(pendingPersistedImage()));

    expect(result.tracking.status).toBe('FAILED');
    expect(rows()).toEqual([expect.objectContaining({ dependency: 'unsplash_download', outcome: 'error' })]);
  });

  it('error de red ⇒ error, nunca lanza', async () => {
    mockFetch(async () => Promise.reject(new TypeError('fetch failed')));
    const { service, rows } = setup();

    await expect(inRequest(() => service.trackDownload(pendingPersistedImage()))).resolves.toMatchObject({
      tracking: { status: 'FAILED' },
    });
    expect(rows()).toEqual([expect.objectContaining({ outcome: 'error' })]);
  });

  it('abort por timeout ⇒ timeout', async () => {
    jest.useFakeTimers();
    global.fetch = hangingFetch() as unknown as typeof fetch;
    const { service, rows } = setup();

    const pending = inRequest(() => service.trackDownload(pendingPersistedImage()));
    await jest.advanceTimersByTimeAsync(UNSPLASH_TIMEOUT_MS + 1000);

    await expect(pending).resolves.toMatchObject({ tracking: { status: 'FAILED' } });
    expect(rows()).toEqual([expect.objectContaining({ dependency: 'unsplash_download', outcome: 'timeout' })]);
  });

  it('URL de tracking inválida ⇒ el wrapper no se llama', async () => {
    const fetchMock = mockFetch(async () => new Response('{}', { status: 200 }));
    const { service, runSpy, writer } = setup();

    const image = pendingPersistedImage({ tracking: { trackingUrl: 'https://evil.example.com/download' } });
    await inRequest(() => service.trackDownload(image));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
    expect(writer.insertDependencyPending).not.toHaveBeenCalled();
  });

  it('sin key ⇒ el wrapper no se llama', async () => {
    mockFetch(async () => new Response('{}', { status: 200 }));
    const { service, runSpy } = setup(''); // '' y no undefined: el parámetro por defecto reemplazaría undefined por ACCESS_KEY

    await inRequest(() => service.trackDownload(pendingPersistedImage()));

    expect(runSpy).not.toHaveBeenCalled();
  });

  it('fuera de request (script operativo) ⇒ operation_id UUID nuevo por invocación, attempt 1', async () => {
    mockFetch(async () => new Response('{}', { status: 200 }));
    const { service, rows } = setup();

    await service.trackDownload(pendingPersistedImage());
    await service.trackDownload(pendingPersistedImage());

    expect(rows().map(r => r.attempt)).toEqual([1, 1]);
    expect(rows()[0].operationId).not.toBe(rows()[1].operationId);
  });

  it('las filas no contienen la URL de tracking ni la key', async () => {
    mockFetch(async () => new Response('{}', { status: 200 }));
    const { service, writer } = setup();

    await inRequest(() => service.trackDownload(pendingPersistedImage()));

    const serialized = JSON.stringify([
      ...(writer.insertDependencyPending as jest.Mock).mock.calls,
      ...(writer.closeDependency as jest.Mock).mock.calls,
    ]);
    expect(serialized).not.toMatch(/https?:|unsplash\.com|ixid|SECRET|eOLpJytrbsQ/i);
  });
});

describe('UnsplashService sin instrumentación (D9: dependencia opcional)', () => {
  it('new UnsplashService(config) sigue funcionando en búsqueda y tracking', async () => {
    mockFetch(async url =>
      url.includes('/search/photos') ? unsplashResponse(unsplashSearchBody([unsplashPhoto()])) : new Response('{}', { status: 200 }),
    );
    const service = new UnsplashService(configWith(ACCESS_KEY));

    const image = await service.searchAndSelectCandidate('Ensalada');
    expect(image).not.toBeNull();
    await expect(service.trackDownload(image!)).resolves.toMatchObject({ tracking: { status: 'SUCCEEDED' } });
  });
});
