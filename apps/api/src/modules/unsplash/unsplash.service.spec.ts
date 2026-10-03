// Contract under test (does not exist yet, red step): apps/api/src/modules/unsplash/unsplash.service.ts
// (design.md section 11.2 / plan.md section 11.2-11.5). Mocks global.fetch and ConfigService —
// never performs a real network request.
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnsplashService, UNSPLASH_TIMEOUT_MS } from './unsplash.service';
import type { RecipeImage } from './recipe-image.types';
import { buildUnsplashQuery } from './unsplash-query.util';

const MOCK_API_KEY = 'test-unsplash-key-12345';

function createConfigServiceMock(apiKeyValue: string | undefined) {
  return {
    get: jest.fn((key: string) => (key === 'UNSPLASH_ACCESS_KEY' ? apiKeyValue : undefined)),
  } as unknown as ConfigService;
}

/** Reads a header off a fetch call's `options.headers`, whatever shape (plain object, Headers
 * instance, array of tuples) the real implementation ends up using. */
function getHeaderValue(headers: unknown, name: string): string | null | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found?.[1];
  }
  const record = headers as Record<string, string>;
  const matchKey = Object.keys(record).find((key) => key.toLowerCase() === name.toLowerCase());
  return matchKey ? record[matchKey] : undefined;
}

/** AC12 (design.md section 7): fails if `apiKey` appears, verbatim, in any logged argument. */
function assertApiKeyNeverLeaked(spies: jest.SpyInstance[], apiKey: string) {
  for (const spy of spies) {
    for (const call of spy.mock.calls) {
      for (const arg of call) {
        const serialized = typeof arg === 'string' ? arg : JSON.stringify(arg);
        expect(serialized ?? '').not.toContain(apiKey);
      }
    }
  }
}

// `id` is a string here (design.md 12.1/12.2 fix #1): Unsplash's real API returns string ids
// (e.g. "LBI7cgq3pbM"), never numbers.
function validCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'LBI7cgq3pbM',
    urls: { regular: 'https://images.unsplash.com/photo-998877?w=1080' },
    links: {
      html: 'https://unsplash.com/photos/998877',
      download_location: 'https://api.unsplash.com/photos/998877/download',
    },
    user: { name: 'Jane Doe', links: { html: 'https://unsplash.com/@jane-doe' } },
    alt_description: 'Ñoquis de papa served on a white plate',
    width: 1920,
    height: 1280,
    ...overrides,
  };
}

describe('UnsplashService.resolveImage', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('(AC3) maps a 200 response into a full RecipeImage and calls the real Unsplash search endpoint with the expected params and Client-ID header', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const title = '  Ñoquis   de\tPapá  ';
    const expectedQuery = buildUnsplashQuery(title);
    const candidate = validCandidate();

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [candidate] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService);
    const result = (await service.resolveImage(title)) as RecipeImage;

    expect(result).not.toBeNull();
    expect(result.provider).toBe('UNSPLASH');
    expect(result.providerPhotoId).toBe(candidate.id);
    expect(result.imageUrl).toBe(candidate.urls.regular);
    // UTM agregado (design.md 12.4) — sourceUrl/photographerUrl ya no son el valor crudo del candidato.
    expect(result.sourceUrl).toBe(`${candidate.links.html}?utm_source=nutria&utm_medium=referral`);
    expect(result.photographer).toBe(candidate.user.name);
    expect(result.photographerUrl).toBe(`${candidate.user.links.html}?utm_source=nutria&utm_medium=referral`);
    expect(result.alt).toBe(candidate.alt_description);
    expect(result.query).toBe(expectedQuery);
    expect(new Date(result.retrievedAt).toISOString()).toBe(result.retrievedAt);

    // 2 llamadas: búsqueda + tracking de download_location (design.md 11.2) — ver describe dedicado más abajo.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
    const urlObj = new URL(String(calledUrl));
    expect(urlObj.origin + urlObj.pathname).toBe('https://api.unsplash.com/search/photos');
    expect(urlObj.searchParams.get('query')).toBe(expectedQuery);
    expect(urlObj.searchParams.get('page')).toBe('1');
    expect(urlObj.searchParams.get('per_page')).toBe('5');
    expect(urlObj.searchParams.get('order_by')).toBe('relevant');
    expect(urlObj.searchParams.get('content_filter')).toBe('high');
    expect(getHeaderValue(calledOptions?.headers, 'Authorization')).toBe(`Client-ID ${MOCK_API_KEY}`);
  });

  it('(design.md 11.2) falls back to "Imagen ilustrativa de <título>" (raw title, not the normalized query) when alt_description is null', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const title = 'Ensalada de Quinoa';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [validCandidate({ alt_description: null })] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService);
    const result = (await service.resolveImage(title)) as RecipeImage;

    expect(result.alt).toBe(`Imagen ilustrativa de ${title}`);
  });

  it('(design.md 11.2) applies the same alt fallback when alt_description is an empty string', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const title = 'Ensalada de Quinoa';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [validCandidate({ alt_description: '' })] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService);
    const result = (await service.resolveImage(title)) as RecipeImage;

    expect(result.alt).toBe(`Imagen ilustrativa de ${title}`);
  });

  it('(AC4) returns null without logging a warning when results is an empty array', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new UnsplashService(configService);
    const result = await service.resolveImage('Pasta Carbonara');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('(AC5) never calls fetch and emits exactly one sanitized warning when UNSPLASH_ACCESS_KEY is missing', async () => {
    const configService = createConfigServiceMock(undefined);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new UnsplashService(configService);
    const result = await service.resolveImage('Pasta Carbonara');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
  });

  it('(AC5 bis) also returns null with no fetch call when UNSPLASH_ACCESS_KEY is an empty string', async () => {
    const configService = createConfigServiceMock('');
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService);
    const result = await service.resolveImage('Pasta Carbonara');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('(AC6) makes exactly one attempt and returns null with a timeout warning when Unsplash never responds within UNSPLASH_TIMEOUT_MS, never leaking the key', async () => {
    jest.useFakeTimers();
    const configService = createConfigServiceMock(MOCK_API_KEY);

    const fetchMock = jest.fn((_url: unknown, options?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        const signal = options?.signal;
        const onAbort = () => {
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        };
        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort);
        }
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new UnsplashService(configService);
    const resultPromise = service.resolveImage('Pasta Carbonara');

    await jest.advanceTimersByTimeAsync(UNSPLASH_TIMEOUT_MS + 1000);
    const result = await resultPromise;

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
  });

  it('(design.md 11.2) returns null without retrying and logs a warning mentioning status 401, never leaking the key', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ errors: ['Invalid access token'] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new UnsplashService(configService);
    const result = await service.resolveImage('Pasta Carbonara');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const loggedStatus = warnSpy.mock.calls.some((call) =>
      call.some((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)).includes('401')),
    );
    expect(loggedStatus).toBe(true);
    assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
  });

  it('(design.md 11.2) returns null without retrying and logs a warning mentioning status 403, never leaking the key', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ errors: ['Forbidden'] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new UnsplashService(configService);
    const result = await service.resolveImage('Pasta Carbonara');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const loggedStatus = warnSpy.mock.calls.some((call) =>
      call.some((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)).includes('403')),
    );
    expect(loggedStatus).toBe(true);
    assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
  });

  it('(AC7) returns null without retrying and logs a warning mentioning status 429, never leaking the key', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ errors: ['Rate Limit Exceeded'] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new UnsplashService(configService);
    const result = await service.resolveImage('Pasta Carbonara');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const loggedStatus = warnSpy.mock.calls.some((call) =>
      call.some((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)).includes('429')),
    );
    expect(loggedStatus).toBe(true);
    assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
  });

  it('(AC8) returns null without retrying and logs a warning mentioning the received 5xx status, never leaking the key', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ errors: ['Service Unavailable'] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new UnsplashService(configService);
    const result = await service.resolveImage('Pasta Carbonara');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const loggedStatus = warnSpy.mock.calls.some((call) =>
      call.some((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)).includes('503')),
    );
    expect(loggedStatus).toBe(true);
    assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
  });

  it('(AC9) returns null without throwing and logs an invalid-response warning when the 200 body is not valid JSON, never leaking the key', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token in JSON');
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new UnsplashService(configService);

    await expect(service.resolveImage('Pasta Carbonara')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
  });

  // Regression guard (design.md 11.2: "timeout de punta a punta cubriendo la lectura completa
  // del cuerpo — corrección ya aplicada ... sigue vigente sin cambios en el mecanismo"): the
  // same AbortSignal must still be honored while reading response.json(), not just while
  // waiting on fetch() itself — a provider that sends headers fast but stalls the body must
  // not hang resolveImage() forever. Bounded to 8000ms of real test-runner time so a
  // regression fails red deterministically instead of hanging the suite.
  it('does not hang forever if fetch() resolves fast (headers arrive) but response.json() stalls past UNSPLASH_TIMEOUT_MS', async () => {
    jest.useFakeTimers();
    const configService = createConfigServiceMock(MOCK_API_KEY);

    const fetchMock = jest.fn((_url: unknown, options?: { signal?: AbortSignal }) => {
      const signal = options?.signal;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            const onAbort = () => {
              const abortError = new Error('The operation was aborted');
              abortError.name = 'AbortError';
              reject(abortError);
            };
            if (signal) {
              if (signal.aborted) onAbort();
              else signal.addEventListener('abort', onAbort);
            }
          }),
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new UnsplashService(configService);
    const resultPromise = service.resolveImage('Pasta Carbonara');

    await jest.advanceTimersByTimeAsync(UNSPLASH_TIMEOUT_MS + 1000);
    const result = await resultPromise;

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
  }, 8000);
});

// D3 optimization (design.md): dedupe by normalized query, not raw title, so two recipe
// titles that normalize to the same query share a single real fetch call.
describe('UnsplashService.attachImages - memoization by normalized query', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('two recipes whose titles normalize to the SAME query (different casing) trigger exactly one fetch call', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [validCandidate({ id: 'tacos-shared' })] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService);

    const days = [
      {
        day: 'MONDAY',
        date: '2026-09-14',
        meals: [
          {
            mealType: 'LUNCH',
            title: 'Tacos de Pollo',
            nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Almuerzo' },
            recipe: {
              title: 'Tacos de Pollo',
              description: 'Tacos clasicos',
              prepMinutes: 10,
              cookMinutes: 15,
              ingredients: [{ name: 'Pollo', quantity: 200, unit: 'g' }],
              instructions: ['Cocinar el pollo', 'Armar los tacos'],
            },
          },
        ],
      },
      {
        day: 'TUESDAY',
        date: '2026-09-15',
        meals: [
          {
            mealType: 'DINNER',
            title: 'tacos de pollo',
            nutritionalValues: { Protein: 18, Fiber: 6, Calories: 340, Description: 'Cena' },
            recipe: {
              title: 'tacos de pollo',
              description: 'Tacos clasicos para la cena',
              prepMinutes: 12,
              cookMinutes: 15,
              ingredients: [{ name: 'Pollo', quantity: 200, unit: 'g' }],
              instructions: ['Cocinar el pollo', 'Armar los tacos'],
            },
          },
        ],
      },
    ] as any;

    await service.attachImages(days);

    // 1 búsqueda + 1 tracking de download_location (design.md 11.2), no 2+2 — la memoización por
    // query normalizada dedupea ambas llamadas, no sólo la búsqueda.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// download_location tracking (design.md 11.2, NUT-83 section 11.2 "Requisito nuevo"): Unsplash
// requires one GET to the chosen candidate's links.download_location, fired once when a
// candidate is picked, never on reads, never blocking or failing the recipe's own result.
describe('UnsplashService.resolveImage - download_location tracking (design.md 11.2)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fires exactly one GET to the chosen candidate\'s download_location, with the same Client-ID header, in addition to the search call', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const candidate = validCandidate();

    const fetchMock = jest.fn((url: unknown, options?: { headers?: unknown }) => {
      if (String(url) === candidate.links.download_location) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ results: [candidate] }) });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService);
    await service.resolveImage('Pasta Carbonara');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const trackingCall = fetchMock.mock.calls.find(([url]) => String(url) === candidate.links.download_location);
    expect(trackingCall).toBeDefined();
    expect(getHeaderValue(trackingCall?.[1]?.headers, 'Authorization')).toBe(`Client-ID ${MOCK_API_KEY}`);
  });

  describe('never fires download_location when no candidate was chosen', () => {
    const scenarios: Array<[string, () => { configService: ConfigService; fetchMock: jest.Mock }]> = [
      [
        'empty results',
        () => ({
          configService: createConfigServiceMock(MOCK_API_KEY),
          fetchMock: jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) }),
        }),
      ],
      [
        'missing api key',
        () => ({
          configService: createConfigServiceMock(undefined),
          fetchMock: jest.fn(),
        }),
      ],
      [
        'provider 5xx failure',
        () => ({
          configService: createConfigServiceMock(MOCK_API_KEY),
          fetchMock: jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
        }),
      ],
    ];

    it.each(scenarios)('%s', async (_label, setup) => {
      const { configService, fetchMock } = setup();
      global.fetch = fetchMock as unknown as typeof fetch;

      const service = new UnsplashService(configService);
      const result = await service.resolveImage('Pasta Carbonara');

      expect(result).toBeNull();
      expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(1);
      const calledADownloadLocation = fetchMock.mock.calls.some(([url]) => String(url).includes('/download'));
      expect(calledADownloadLocation).toBe(false);
    });
  });

  it('a failed tracking call never affects resolveImage\'s own result: still returns the full RecipeImage and logs an error (not a warning), without leaking the key', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const candidate = validCandidate();

    const fetchMock = jest.fn((url: unknown) => {
      if (String(url) === candidate.links.download_location) {
        return Promise.reject(new Error('tracking network error'));
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ results: [candidate] }) });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');
    const errorSpy = jest.spyOn(Logger.prototype, 'error');

    const service = new UnsplashService(configService);
    const result = (await service.resolveImage('Pasta Carbonara')) as RecipeImage;

    expect(result).not.toBeNull();
    expect(result.provider).toBe('UNSPLASH');
    expect(result.providerPhotoId).toBe(candidate.id);
    expect(result.imageUrl).toBe(candidate.urls.regular);
    expect(result.sourceUrl).toBe(`${candidate.links.html}?utm_source=nutria&utm_medium=referral`);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedProviderPhotoIdAndUrl = errorSpy.mock.calls.some((call) =>
      call.some((arg) => {
        const serialized = typeof arg === 'string' ? arg : JSON.stringify(arg);
        return serialized?.includes(String(candidate.id)) && serialized?.includes(candidate.links.download_location);
      }),
    );
    expect(loggedProviderPhotoIdAndUrl).toBe(true);
    assertApiKeyNeverLeaked([warnSpy, errorSpy], MOCK_API_KEY);
  });

  it('download_location never appears anywhere in the RecipeImage object returned by resolveImage', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const candidate = validCandidate();

    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [candidate] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService);
    const result = (await service.resolveImage('Pasta Carbonara')) as RecipeImage;

    expect(Object.keys(result).sort()).toEqual(
      ['alt', 'imageUrl', 'photographer', 'photographerUrl', 'provider', 'providerPhotoId', 'query', 'retrievedAt', 'sourceUrl'].sort(),
    );
    expect(JSON.stringify(result)).not.toContain('download_location');
  });
});

describe('UnsplashService.attachImages - download_location tracking is deduplicated within a batch (design.md 11.2)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('two recipes that normalize to the same query (already deduped for search) also share a single download_location call, not one per recipe', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const candidate = validCandidate({ id: 'tacos-shared-2' });

    const fetchMock = jest.fn((url: unknown) => {
      if (String(url) === candidate.links.download_location) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ results: [candidate] }) });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService);

    const days = [
      {
        day: 'MONDAY',
        date: '2026-09-14',
        meals: [
          {
            mealType: 'LUNCH',
            title: 'Tacos de Pollo',
            nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Almuerzo' },
            recipe: {
              title: 'Tacos de Pollo',
              description: 'Tacos clasicos',
              prepMinutes: 10,
              cookMinutes: 15,
              ingredients: [{ name: 'Pollo', quantity: 200, unit: 'g' }],
              instructions: ['Cocinar el pollo', 'Armar los tacos'],
            },
          },
        ],
      },
      {
        day: 'TUESDAY',
        date: '2026-09-15',
        meals: [
          {
            mealType: 'DINNER',
            title: 'tacos de pollo',
            nutritionalValues: { Protein: 18, Fiber: 6, Calories: 340, Description: 'Cena' },
            recipe: {
              title: 'tacos de pollo',
              description: 'Tacos clasicos para la cena',
              prepMinutes: 12,
              cookMinutes: 15,
              ingredients: [{ name: 'Pollo', quantity: 200, unit: 'g' }],
              instructions: ['Cocinar el pollo', 'Armar los tacos'],
            },
          },
        ],
      },
    ] as any;

    await service.attachImages(days);

    const searchCalls = fetchMock.mock.calls.filter(([url]) => String(url) !== candidate.links.download_location);
    const trackingCalls = fetchMock.mock.calls.filter(([url]) => String(url) === candidate.links.download_location);

    expect(searchCalls.length).toBe(1);
    expect(trackingCalls.length).toBe(1);
  });
});

// Bug de revisión (CRÍTICO, design.md 11.2): a diferencia de la búsqueda, trackDownload no usa
// AbortController/setTimeout propio. Si el fetch de download_location nunca se asienta,
// resolveImage debe igual resolver (no colgarse para siempre). Acotado a 8000ms de tiempo real
// del test runner para fallar en rojo de forma determinística en vez de colgar la suite, mismo
// criterio que el test de timeout de búsqueda ya existente más arriba.
describe('UnsplashService.resolveImage - trackDownload debe tener su propio timeout (BUG)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it(
    'resuelve (no se cuelga para siempre) si la llamada a download_location nunca se asienta por sí sola',
    async () => {
      jest.useFakeTimers();
      const configService = createConfigServiceMock(MOCK_API_KEY);
      const candidate = validCandidate();

      const fetchMock = jest.fn((url: unknown, options?: { signal?: AbortSignal }) => {
        if (String(url) === candidate.links.download_location) {
          // Mismo patrón que el mock de timeout de búsqueda: sólo se asienta si se la aborta.
          return new Promise((_resolve, reject) => {
            const signal = options?.signal;
            const onAbort = () => {
              const abortError = new Error('The operation was aborted');
              abortError.name = 'AbortError';
              reject(abortError);
            };
            if (signal) {
              if (signal.aborted) onAbort();
              else signal.addEventListener('abort', onAbort);
            }
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ results: [candidate] }) });
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const service = new UnsplashService(configService);
      const resultPromise = service.resolveImage('Pasta Carbonara');

      await jest.advanceTimersByTimeAsync(UNSPLASH_TIMEOUT_MS + 1000);
      const result = await resultPromise;

      expect(result).not.toBeUndefined();
    },
    8000,
  );
});

// Bug de revisión (ALTO, design.md 11.2): fetch() no lanza por un status HTTP de error, sólo
// por fallos de red/transporte. trackDownload no revisa response.status, así que un 401/403/
// 429/5xx de tracking se trata hoy como "éxito silencioso" (ningún log), contradiciendo la
// promesa de design.md de loguear exactamente esos casos como error.
describe('UnsplashService.resolveImage - trackDownload debe revisar response.ok/status (BUG)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('loguea error (con el status y el providerPhotoId, sin la key) cuando download_location responde 429 resuelto (no rechazado), y resolveImage igual devuelve el RecipeImage completo', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const candidate = validCandidate();

    const fetchMock = jest.fn((url: unknown) => {
      if (String(url) === candidate.links.download_location) {
        return Promise.resolve({ ok: false, status: 429, json: async () => ({ errors: ['Rate Limit Exceeded'] }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ results: [candidate] }) });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');
    const errorSpy = jest.spyOn(Logger.prototype, 'error');

    const service = new UnsplashService(configService);
    const result = (await service.resolveImage('Pasta Carbonara')) as RecipeImage;

    expect(result).not.toBeNull();
    expect(result.provider).toBe('UNSPLASH');
    expect(result.providerPhotoId).toBe(candidate.id);
    expect(result.imageUrl).toBe(candidate.urls.regular);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedStatusAndId = errorSpy.mock.calls.some((call) =>
      call.some((arg) => {
        const serialized = typeof arg === 'string' ? arg : JSON.stringify(arg);
        return serialized?.includes('429') && serialized?.includes(String(candidate.id));
      }),
    );
    expect(loggedStatusAndId).toBe(true);
    assertApiKeyNeverLeaked([warnSpy, errorSpy], MOCK_API_KEY);
  });
});

// Bug de revisión (MEDIO, design.md 11.2): el fallback de alt debe usar el título original DE
// LA RECETA, no el título "representante" (primera receta vista) de la query compartida por
// memoización.
describe('UnsplashService.attachImages - el fallback de alt usa el título propio de cada receta (BUG)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('dos recetas con la misma query normalizada pero títulos originales distintos en casing/espacios terminan con un alt distinto entre sí', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const candidate = validCandidate({ alt_description: null });

    const fetchMock = jest.fn((url: unknown) => {
      if (String(url) === candidate.links.download_location) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ results: [candidate] }) });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService);

    const titleA = 'Tacos  de Pollo';
    const titleB = 'tacos de pollo';

    const days = [
      {
        day: 'MONDAY',
        date: '2026-09-14',
        meals: [
          {
            mealType: 'LUNCH',
            title: titleA,
            nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Almuerzo' },
            recipe: {
              title: titleA,
              description: 'Tacos clasicos',
              prepMinutes: 10,
              cookMinutes: 15,
              ingredients: [{ name: 'Pollo', quantity: 200, unit: 'g' }],
              instructions: ['Cocinar el pollo', 'Armar los tacos'],
            },
          },
        ],
      },
      {
        day: 'TUESDAY',
        date: '2026-09-15',
        meals: [
          {
            mealType: 'DINNER',
            title: titleB,
            nutritionalValues: { Protein: 18, Fiber: 6, Calories: 340, Description: 'Cena' },
            recipe: {
              title: titleB,
              description: 'Tacos clasicos para la cena',
              prepMinutes: 12,
              cookMinutes: 15,
              ingredients: [{ name: 'Pollo', quantity: 200, unit: 'g' }],
              instructions: ['Cocinar el pollo', 'Armar los tacos'],
            },
          },
        ],
      },
    ] as any;

    const result = await service.attachImages(days);

    const altA = result[0].meals[0].recipe.image.alt;
    const altB = result[1].meals[0].recipe.image.alt;

    expect(altA).toBe(`Imagen ilustrativa de ${titleA}`);
    expect(altB).toBe(`Imagen ilustrativa de ${titleB}`);
    expect(altA).not.toBe(altB);
  });
});

// UTM on sourceUrl/photographerUrl (design.md 12.4 / plan.md 12.1.3.a): not implemented yet,
// expected red until withAttributionUtm() lands. imageUrl must never be touched - ixid and any
// other provider params must survive byte-for-byte.
describe('UnsplashService.resolveImage - UTM attribution on sourceUrl/photographerUrl (design.md 12.4)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('adds utm_source=nutria&utm_medium=referral to sourceUrl and photographerUrl, preserving any existing query param, while leaving imageUrl byte-for-byte identical to urls.regular', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const candidate = validCandidate({
      id: 'photo-utm',
      urls: {
        regular:
          'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?ixid=M3w0NjAwMjN8MHwxfHNlYXJjaHwxfHxmb29kfGVufDB8fHx8MTcwMDAwMDAwMHww&ixlib=rb-4.0.3',
      },
      links: {
        html: 'https://unsplash.com/photos/photo-utm?ref=search',
        download_location: 'https://api.unsplash.com/photos/photo-utm/download',
      },
      user: { name: 'Jane Doe', links: { html: 'https://unsplash.com/@jane-doe?ref=profile' } },
    });

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [candidate] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService);
    const result = (await service.resolveImage('Pasta Carbonara')) as RecipeImage;

    expect(result.imageUrl).toBe(candidate.urls.regular);

    const sourceUrl = new URL(result.sourceUrl);
    expect(sourceUrl.origin + sourceUrl.pathname).toBe('https://unsplash.com/photos/photo-utm');
    expect(sourceUrl.searchParams.get('ref')).toBe('search');
    expect(sourceUrl.searchParams.get('utm_source')).toBe('nutria');
    expect(sourceUrl.searchParams.get('utm_medium')).toBe('referral');

    const photographerUrl = new URL(result.photographerUrl);
    expect(photographerUrl.origin + photographerUrl.pathname).toBe('https://unsplash.com/@jane-doe');
    expect(photographerUrl.searchParams.get('ref')).toBe('profile');
    expect(photographerUrl.searchParams.get('utm_source')).toBe('nutria');
    expect(photographerUrl.searchParams.get('utm_medium')).toBe('referral');
  });

  it('replaces (not duplicates) a pre-existing utm_source/utm_medium on sourceUrl', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const candidate = validCandidate({
      id: 'photo-utm-2',
      links: {
        html: 'https://unsplash.com/photos/photo-utm-2?utm_source=old&utm_medium=old-medium',
        download_location: 'https://api.unsplash.com/photos/photo-utm-2/download',
      },
    });

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [candidate] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService);
    const result = (await service.resolveImage('Pasta Carbonara')) as RecipeImage;

    const sourceUrl = new URL(result.sourceUrl);
    expect(sourceUrl.searchParams.getAll('utm_source')).toEqual(['nutria']);
    expect(sourceUrl.searchParams.getAll('utm_medium')).toEqual(['referral']);
  });
});

// Fix #3/#4 (design.md 12.3/12.8 AC3-AC4): a candidate whose download_location host isn't
// api.unsplash.com must already be rejected at selection time, so resolveImage never attempts
// that fetch at all - with or without the Authorization header. Structural consequence of
// selectUnsplashCandidate's new host-validation step; this test confirms it end-to-end.
describe('UnsplashService.resolveImage - never sends Authorization to an unvalidated host (design.md 12.3)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('discards the only candidate when its download_location points to a non-Unsplash host, and never fetches that host at all', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const candidate = validCandidate({
      id: 'photo-evil-download',
      links: {
        html: 'https://unsplash.com/photos/photo-evil-download',
        download_location: 'https://evil.com/photos/photo-evil-download/download',
      },
    });

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [candidate] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService);
    const result = await service.resolveImage('Pasta Carbonara');

    expect(result).toBeNull();
    // Only the search call - never a call to the evil host, not even without the header.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledEvilHost = fetchMock.mock.calls.some(([url]) => String(url).includes('evil.com'));
    expect(calledEvilHost).toBe(false);
  });
});

/** Minimal Headers-like mock: only `get` is used by the implementation (design.md 12.7). */
function headersWith(remaining: string | null) {
  return { get: (name: string) => (name.toLowerCase() === 'x-ratelimit-remaining' ? remaining : null) };
}

// 401/403 get their own message, distinct from the generic "unexpected status" one used for
// every other non-200 (design.md 12.7, bug #7): the key must still never appear.
describe('UnsplashService - 401/403 specific invalid-configuration message (design.md 12.7)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it.each([401, 403])(
    'status %i logs an "invalid configuration" warning, never the generic unexpected-status one, and never the key',
    async (status) => {
      const configService = createConfigServiceMock(MOCK_API_KEY);
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status,
        headers: headersWith(null),
        json: async () => ({ errors: ['Invalid access token'] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      const service = new UnsplashService(configService);
      const result = await service.resolveImage('Pasta Carbonara');

      expect(result).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const loggedInvalidConfig = warnSpy.mock.calls.some((call) =>
        call.some((arg) => {
          const serialized = typeof arg === 'string' ? arg : JSON.stringify(arg);
          return /invalid/i.test(serialized) && /config/i.test(serialized);
        }),
      );
      expect(loggedInvalidConfig).toBe(true);

      const loggedGenericStatus = warnSpy.mock.calls.some((call) =>
        call.some((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)).includes('unexpected status')),
      );
      expect(loggedGenericStatus).toBe(false);

      assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
    },
  );
});

// Quota handling via X-Ratelimit-Remaining (design.md 12.7): state lives on the instance,
// updated from every search response regardless of status, and blocks the NEXT search once it
// hits zero - never the call that reported zero, which already used the quota it consumed.
describe('UnsplashService - quota handling via X-Ratelimit-Remaining (design.md 12.7)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('a 200 response carrying X-Ratelimit-Remaining: "0" is still used normally; only the NEXT call on the same instance is cut off', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const candidate = validCandidate();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: headersWith('0'),
      json: async () => ({ results: [candidate] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new UnsplashService(configService);

    const first = await service.resolveImage('Pasta Carbonara');
    expect(first).not.toBeNull();
    const callsAfterFirst = fetchMock.mock.calls.length;

    const second = await service.resolveImage('Ensalada de Quinoa');
    expect(second).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);

    const loggedQuotaExhausted = warnSpy.mock.calls.some((call) =>
      call.some((arg) => {
        const serialized = typeof arg === 'string' ? arg : JSON.stringify(arg);
        return /quota/i.test(serialized) && /exhaust/i.test(serialized);
      }),
    );
    expect(loggedQuotaExhausted).toBe(true);
    assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
  });

  it('the cutoff is read from error responses too: a 429 carrying X-Ratelimit-Remaining: "0" still blocks the next call', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: headersWith('0'),
      json: async () => ({ errors: ['Rate Limit Exceeded'] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService);

    const first = await service.resolveImage('Pasta Carbonara');
    expect(first).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await service.resolveImage('Ensalada de Quinoa');
    expect(second).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no new fetch attempted for the second call
  });

  it('a missing X-Ratelimit-Remaining header leaves quota state untouched: the next call still fetches normally', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const candidate = validCandidate();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: headersWith(null),
      json: async () => ({ results: [candidate] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService);

    await service.resolveImage('Pasta Carbonara');
    const callsAfterFirst = fetchMock.mock.calls.length;

    await service.resolveImage('Ensalada de Quinoa');
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it.each(['abc', '-1'])(
    'an X-Ratelimit-Remaining value that does not parse as a non-negative integer ("%s") leaves quota state untouched',
    async (invalidValue) => {
      const configService = createConfigServiceMock(MOCK_API_KEY);
      const candidate = validCandidate();
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: headersWith(invalidValue),
        json: async () => ({ results: [candidate] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const service = new UnsplashService(configService);

      await service.resolveImage('Pasta Carbonara');
      const callsAfterFirst = fetchMock.mock.calls.length;

      await service.resolveImage('Ensalada de Quinoa');
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    },
  );

  it('two different UnsplashService instances do not share quota state', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: headersWith('0'),
      json: async () => ({ errors: ['Rate Limit Exceeded'] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const serviceA = new UnsplashService(configService);
    await serviceA.resolveImage('Pasta Carbonara'); // drains serviceA's own quota to 0

    const serviceB = new UnsplashService(configService);
    const resultB = await serviceB.resolveImage('Ensalada de Quinoa');

    expect(resultB).toBeNull(); // still null because every response here is a 429, not because of quota
    expect(fetchMock).toHaveBeenCalledTimes(2); // one attempt per instance - serviceB was not cut off
  });
});

// ------------------------------------------------------------------------------------------
// Ciclo B (design.md 12.5.2, plan.md 12.1.3.b) - split search+select vs. tracking.
//
// Naming decision (not fixed by design.md, documented here per this cycle's instructions): the
// search+select step is exposed as a NEW method, `searchAndSelectCandidate`, kept separate from
// the existing `resolveImage` (whose current contract/tests are out of scope for this cycle) to
// avoid silently redefining an already-tested method. `trackDownload` becomes public, moving
// (not rewriting) the timeout/host-validation/error-logging logic that used to live inside the
// old private `trackDownload(candidate, apiKey)`, now taking the full persisted image and
// returning an updated COPY instead of void.
// ------------------------------------------------------------------------------------------

function pendingPersistedImage(overrides: Record<string, unknown> = {}) {
  const candidate = validCandidate();
  return {
    provider: 'UNSPLASH',
    providerPhotoId: candidate.id,
    imageUrl: candidate.urls.regular,
    sourceUrl: `${candidate.links.html}?utm_source=nutria&utm_medium=referral`,
    photographer: candidate.user.name,
    photographerUrl: `${candidate.user.links.html}?utm_source=nutria&utm_medium=referral`,
    alt: candidate.alt_description,
    query: 'pasta carbonara food recipe',
    retrievedAt: '2026-09-30T12:00:00.000Z',
    tracking: {
      status: 'PENDING' as const,
      lastAttemptAt: null as string | null,
      trackingUrl: candidate.links.download_location,
    },
    ...overrides,
  };
}

describe('UnsplashService.searchAndSelectCandidate - search+select only, no tracking fetch yet (design.md 12.5.2 paso 1, ciclo B)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns a PersistedRecipeImage with tracking.status PENDING, lastAttemptAt null and trackingUrl = download_location, having called fetch exactly once (the search, never download_location)', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const candidate = validCandidate();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [candidate] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService) as any;
    const result = await service.searchAndSelectCandidate('Pasta Carbonara');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.tracking).toEqual({
      status: 'PENDING',
      lastAttemptAt: null,
      trackingUrl: candidate.links.download_location,
    });
    // The public 9 fields are already fully resolved at this step (design.md 12.5.1): only the
    // DB write and the tracking fetch itself are deferred, not the mapping.
    expect(result.provider).toBe('UNSPLASH');
    expect(result.providerPhotoId).toBe(candidate.id);
    expect(result.imageUrl).toBe(candidate.urls.regular);
  });

  it('returns null, with fetch still called exactly once, when there is no valid candidate', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService) as any;
    const result = await service.searchAndSelectCandidate('Pasta Carbonara');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('UnsplashService.trackDownload(persistedImage) - post-persistence tracking (design.md 12.5.2 paso 3, ciclo B)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("fetches tracking.trackingUrl once with the Client-ID header and returns a COPY with tracking.status SUCCEEDED and a valid ISO lastAttemptAt, leaving the public 9 fields untouched", async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const pending = pendingPersistedImage();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService) as any;
    const result = await service.trackDownload(pending);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toBe(pending.tracking.trackingUrl);
    expect(getHeaderValue(calledOptions?.headers, 'Authorization')).toBe(`Client-ID ${MOCK_API_KEY}`);

    expect(result.tracking.status).toBe('SUCCEEDED');
    expect(new Date(result.tracking.lastAttemptAt).toISOString()).toBe(result.tracking.lastAttemptAt);
    expect(result.provider).toBe(pending.provider);
    expect(result.imageUrl).toBe(pending.imageUrl);

    // Returns a copy - calling trackDownload must never mutate the argument.
    expect(pending.tracking.status).toBe('PENDING');
  });

  it.each([
    ['rejected fetch (network error)', () => Promise.reject(new Error('network error'))],
    ['resolved but non-ok status (429)', () => Promise.resolve({ ok: false, status: 429, json: async () => ({}) })],
  ])('%s results in tracking.status FAILED with lastAttemptAt set, without throwing', async (_label, makeResponse) => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const pending = pendingPersistedImage();
    const fetchMock = jest.fn(() => makeResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService) as any;
    const result = await service.trackDownload(pending);

    expect(result.tracking.status).toBe('FAILED');
    expect(result.tracking.lastAttemptAt).not.toBeNull();
  });

  it(
    'times out on its own after UNSPLASH_TIMEOUT_MS (single attempt, same mechanism as search) and resolves to FAILED instead of hanging',
    async () => {
      jest.useFakeTimers();
      const configService = createConfigServiceMock(MOCK_API_KEY);
      const pending = pendingPersistedImage();
      const fetchMock = jest.fn((_url: unknown, options?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          const signal = options?.signal;
          const onAbort = () => {
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          };
          if (signal) {
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort);
          }
        });
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const service = new UnsplashService(configService) as any;
      const resultPromise = service.trackDownload(pending);

      await jest.advanceTimersByTimeAsync(UNSPLASH_TIMEOUT_MS + 1000);
      const result = await resultPromise;

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.tracking.status).toBe('FAILED');
    },
    8000,
  );

  it('never attaches Authorization and returns FAILED immediately when the persisted trackingUrl host is not api.unsplash.com (defense in depth, design.md 12.3)', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const pending = pendingPersistedImage({
      tracking: { status: 'PENDING', lastAttemptAt: null, trackingUrl: 'https://evil.com/photos/x/download' },
    });
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService) as any;
    const result = await service.trackDownload(pending);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.tracking.status).toBe('FAILED');
  });

  it('degrades to FAILED without throwing and without calling fetch when UNSPLASH_ACCESS_KEY is missing at tracking time (D4 reapplied, plan.md 12.1.3.b)', async () => {
    const configService = createConfigServiceMock(undefined);
    const pending = pendingPersistedImage();
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new UnsplashService(configService) as any;
    const result = await service.trackDownload(pending);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.tracking.status).toBe('FAILED');
  });

  it('logs the failure at error level with providerPhotoId and trackingUrl, never the key (reuses the sanitized logging already proven for the old tracking path)', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const pending = pendingPersistedImage();
    const fetchMock = jest.fn().mockRejectedValue(new Error('tracking network error'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const errorSpy = jest.spyOn(Logger.prototype, 'error');

    const service = new UnsplashService(configService) as any;
    const result = await service.trackDownload(pending);

    expect(result.tracking.status).toBe('FAILED');
    const loggedProviderPhotoIdAndUrl = errorSpy.mock.calls.some((call) =>
      call.some((arg) => {
        const serialized = typeof arg === 'string' ? arg : JSON.stringify(arg);
        return serialized?.includes(pending.providerPhotoId) && serialized?.includes(pending.tracking.trackingUrl);
      }),
    );
    expect(loggedProviderPhotoIdAndUrl).toBe(true);
    assertApiKeyNeverLeaked([errorSpy], MOCK_API_KEY);
  });
});

describe('toPublicRecipeImage - strips private tracking metadata (design.md 12.5.1, ciclo B)', () => {
  // Import location assumed to be a named export of unsplash.service.ts (design.md 12.5.1's
  // "función única de mapeo público" can live wherever the implementer prefers); resolved
  // dynamically and cast to `any` so a missing export fails this one assertion, not the whole
  // file's compilation, if the implementer extracts it to its own util file instead.
  async function loadToPublicRecipeImage(): Promise<(persisted: unknown) => unknown> {
    const mod: any = await import('./unsplash.service');
    return mod.toPublicRecipeImage;
  }

  it('returns exactly the 9 public RecipeImage fields, never the "tracking" key, for a persisted image with tracking in any state', async () => {
    const toPublicRecipeImage = await loadToPublicRecipeImage();
    const persisted = pendingPersistedImage({
      tracking: {
        status: 'SUCCEEDED',
        lastAttemptAt: '2026-09-30T12:00:00.000Z',
        trackingUrl: 'https://api.unsplash.com/photos/x/download',
      },
    });

    const result = toPublicRecipeImage(persisted) as any;

    expect(Object.keys(result).sort()).toEqual(
      ['alt', 'imageUrl', 'photographer', 'photographerUrl', 'provider', 'providerPhotoId', 'query', 'retrievedAt', 'sourceUrl'].sort(),
    );
    expect(result.tracking).toBeUndefined();
  });

  it('returns null when given null', async () => {
    const toPublicRecipeImage = await loadToPublicRecipeImage();
    expect(toPublicRecipeImage(null)).toBeNull();
  });
});
