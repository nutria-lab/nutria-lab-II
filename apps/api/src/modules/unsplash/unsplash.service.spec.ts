// Nunca llama a Unsplash de verdad: fetch está mockeado con respuestas de unsplash-search.fixture.ts.
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  UnsplashService,
  UNSPLASH_MAX_CONCURRENT_REQUESTS,
  UNSPLASH_QUOTA_FALLBACK_COOLDOWN_MS,
  UNSPLASH_TIMEOUT_MS,
  toPublicRecipeImage,
} from './unsplash.service';
import { buildUnsplashQuery } from './unsplash-query.util';
import {
  hangingFetch,
  pendingPersistedImage,
  unsplashPhoto,
  unsplashResponse,
  unsplashSearchBody,
} from './unsplash-search.fixture';

const MOCK_API_KEY = 'test-unsplash-key-12345';
const PUBLIC_IMAGE_KEYS = ['alt', 'imageUrl', 'photographer', 'photographerUrl', 'provider', 'providerPhotoId', 'query', 'retrievedAt', 'sourceUrl'];

function createConfigServiceMock(apiKeyValue: string | undefined) {
  return {
    get: jest.fn((key: string) => (key === 'UNSPLASH_ACCESS_KEY' ? apiKeyValue : undefined)),
  } as unknown as ConfigService;
}

function mockFetch(implementation: (url: string, options?: RequestInit) => Promise<unknown>) {
  const fetchMock = jest.fn((url: unknown, options?: RequestInit) => implementation(String(url), options));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function authorizationHeader(options: RequestInit | undefined): string | undefined {
  return (options?.headers as Record<string, string> | undefined)?.Authorization;
}

function spyOnAllLogs() {
  return ['log', 'warn', 'error', 'debug', 'verbose'].map((method) => jest.spyOn(Logger.prototype, method as 'log'));
}

function loggedText(spies: jest.SpyInstance[]): string {
  return spies
    .flatMap((spy) => spy.mock.calls.flat())
    .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
    .join('\n');
}

function buildDay(date: string, titles: string[]) {
  return {
    day: 'MONDAY',
    date,
    meals: titles.map((title) => ({
      mealType: 'LUNCH',
      title,
      nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Almuerzo' },
      recipe: {
        title,
        description: 'Receta de prueba',
        prepMinutes: 10,
        cookMinutes: 15,
        ingredients: [{ name: 'Ingrediente', quantity: 100, unit: 'g' }],
        instructions: ['Paso unico'],
      },
    })),
  } as any;
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('UnsplashService.searchAndSelectCandidate - request and mapping', () => {
  it('calls GET /search/photos once with the ticket parameters and the Client-ID header, and never calls download_location', async () => {
    const title = '  Ñoquis   de\tPapá  ';
    const fetchMock = mockFetch(async () => unsplashResponse(unsplashSearchBody([unsplashPhoto()])));

    await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectCandidate(title);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
    const url = new URL(String(calledUrl));
    expect(url.origin + url.pathname).toBe('https://api.unsplash.com/search/photos');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: 'noquis de papa food recipe',
      page: '1',
      per_page: '5',
      order_by: 'relevant',
      content_filter: 'high',
    });
    expect(authorizationHeader(calledOptions)).toBe(`Client-ID ${MOCK_API_KEY}`);
  });

  it('maps every public field from the real response shape and stores tracking as PENDING with download_location', async () => {
    const photo = unsplashPhoto();
    mockFetch(async () => unsplashResponse(unsplashSearchBody([photo])));

    const image = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectCandidate('Ensalada de Quinoa');

    expect(image).toEqual({
      provider: 'UNSPLASH',
      providerPhotoId: 'eOLpJytrbsQ',
      imageUrl: photo.urls.regular,
      sourceUrl: `${photo.links.html}?utm_source=nutria&utm_medium=referral`,
      photographer: 'Anna Pelzer',
      photographerUrl: 'https://unsplash.com/@anna_pelzer?utm_source=nutria&utm_medium=referral',
      alt: 'green vegetable salad in white ceramic bowl',
      query: buildUnsplashQuery('Ensalada de Quinoa'),
      retrievedAt: expect.any(String),
      tracking: { status: 'PENDING', lastAttemptAt: null, trackingUrl: photo.links.download_location },
    });
    expect(new Date(image!.retrievedAt).toISOString()).toBe(image!.retrievedAt);
  });

  it('keeps imageUrl byte-for-byte, ixid and every other parameter included', async () => {
    const photo = unsplashPhoto();
    mockFetch(async () => unsplashResponse(unsplashSearchBody([photo])));

    const image = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectCandidate('Ensalada');

    expect(image!.imageUrl).toBe(photo.urls.regular);
    expect(new URL(image!.imageUrl).searchParams.get('ixid')).toBeTruthy();
    expect(new URL(image!.imageUrl).searchParams.has('utm_source')).toBe(false);
  });

  it('adds the attribution UTM to sourceUrl and photographerUrl while keeping their existing parameters, and replaces a pre-existing utm', async () => {
    const photo = unsplashPhoto('LBI7cgq3pbM', {
      links: { html: 'https://unsplash.com/photos/LBI7cgq3pbM?lang=es&utm_source=other' },
      user: { links: { html: 'https://unsplash.com/@anna_pelzer?tab=photos' } },
    });
    mockFetch(async () => unsplashResponse(unsplashSearchBody([photo])));

    const image = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectCandidate('Ensalada');

    const source = new URL(image!.sourceUrl);
    expect(source.searchParams.get('lang')).toBe('es');
    expect(source.searchParams.getAll('utm_source')).toEqual(['nutria']);
    expect(source.searchParams.get('utm_medium')).toBe('referral');
    const photographer = new URL(image!.photographerUrl);
    expect(photographer.searchParams.get('tab')).toBe('photos');
    expect(photographer.searchParams.get('utm_source')).toBe('nutria');
    expect(photographer.searchParams.get('utm_medium')).toBe('referral');
  });

  it.each([null, ''])('falls back to "Imagen ilustrativa de <título>" (raw title) when alt_description is %p', async (altDescription) => {
    mockFetch(async () => unsplashResponse(unsplashSearchBody([unsplashPhoto('eOLpJytrbsQ', { alt_description: altDescription })])));

    const image = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectCandidate('Ensalada de Quinoa');

    expect(image!.alt).toBe('Imagen ilustrativa de Ensalada de Quinoa');
  });

  it('chooses the first valid candidate in relevance order, skipping invalid ones', async () => {
    const results = [
      unsplashPhoto('noDownload01', { links: { download_location: '' } }),
      unsplashPhoto('httpImage002', { urls: { regular: 'http://images.unsplash.com/photo-1?ixid=abc' } }),
      unsplashPhoto('secondValid3'),
      unsplashPhoto('thirdValid04'),
    ];
    mockFetch(async () => unsplashResponse(unsplashSearchBody(results)));

    const image = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectCandidate('Ensalada');

    expect(image!.providerPhotoId).toBe('secondValid3');
  });

  it('discards a candidate whose download_location points to another host, and never sends a request there', async () => {
    const fetchMock = mockFetch(async () =>
      unsplashResponse(unsplashSearchBody([unsplashPhoto('evilHost0001', { links: { download_location: 'https://evil.example.com/photos/x/download' } })])),
    );

    const image = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectCandidate('Ensalada');

    expect(image).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('evil.example.com'))).toBe(false);
  });

  it('returns null without a warning when the search has no results', async () => {
    mockFetch(async () => unsplashResponse(unsplashSearchBody([])));
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const image = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectCandidate('Ensalada');

    expect(image).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns null with a warning when every candidate is invalid', async () => {
    mockFetch(async () => unsplashResponse(unsplashSearchBody([unsplashPhoto('zeroWidth001', { width: 0 })])));
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const image = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectCandidate('Ensalada');

    expect(image).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('UnsplashService.searchAndSelectCandidate - errors degrade to image: null', () => {
  it.each([undefined, ''])('never calls fetch and logs one sanitized warning when UNSPLASH_ACCESS_KEY is %p', async (apiKey) => {
    const fetchMock = mockFetch(async () => unsplashResponse(unsplashSearchBody([unsplashPhoto()])));
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const image = await new UnsplashService(createConfigServiceMock(apiKey)).searchAndSelectCandidate('Ensalada');

    expect(image).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('UNSPLASH_ACCESS_KEY is missing');
  });

  it.each([401, 403])('on %i logs an invalid-configuration warning without the key, in a single attempt', async (status) => {
    const fetchMock = mockFetch(async () => unsplashResponse({ errors: ['OAuth error: The access token is invalid'] }, { status }));
    const logSpies = spyOnAllLogs();

    const image = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectCandidate('Ensalada');

    expect(image).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loggedText(logSpies)).toContain(`Unsplash configuration appears invalid (status ${status})`);
    expect(loggedText(logSpies)).not.toContain(MOCK_API_KEY);
  });

  it.each([429, 500, 503])('on %i makes a single attempt, logs the status and never the key', async (status) => {
    const fetchMock = mockFetch(async () => unsplashResponse({ errors: ['Rate Limit Exceeded'] }, { status }));
    const logSpies = spyOnAllLogs();

    const image = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectCandidate('Ensalada');

    expect(image).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loggedText(logSpies)).toContain(`unexpected status ${status}`);
    expect(loggedText(logSpies)).not.toContain(MOCK_API_KEY);
  });

  it('returns null with a warning when a 200 body is not valid JSON', async () => {
    const fetchMock = mockFetch(async () => unsplashResponse('<html>Bad gateway</html>'));
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const image = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectCandidate('Ensalada');

    expect(image).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('invalid (non-JSON)');
  });

  it('returns null with a warning when fetch itself rejects (network error)', async () => {
    mockFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const image = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectCandidate('Ensalada');

    expect(image).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('times out after UNSPLASH_TIMEOUT_MS in a single attempt when Unsplash never answers', async () => {
    jest.useFakeTimers();
    const fetchMock = hangingFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const resultPromise = new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectCandidate('Ensalada');
    await jest.advanceTimersByTimeAsync(UNSPLASH_TIMEOUT_MS + 1000);

    await expect(resultPromise).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('timed out');
  }, 8000);

  it('also times out when the headers arrive but the body stalls past UNSPLASH_TIMEOUT_MS', async () => {
    jest.useFakeTimers();
    mockFetch(async (_url, options) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => hangingFetch()('', { signal: options?.signal ?? undefined }),
    }));

    const resultPromise = new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectCandidate('Ensalada');
    await jest.advanceTimersByTimeAsync(UNSPLASH_TIMEOUT_MS + 1000);

    await expect(resultPromise).resolves.toBeNull();
  }, 8000);
});

describe('UnsplashService - quota from X-Ratelimit-Remaining', () => {
  const NOW = Date.parse('2026-10-03T12:00:00.000Z');

  function serviceWithClock() {
    const clock = { now: NOW };
    jest.spyOn(Date, 'now').mockImplementation(() => clock.now);
    return { service: new UnsplashService(createConfigServiceMock(MOCK_API_KEY)), clock };
  }

  it('uses the response that reports remaining 0, but skips the next search with a warning', async () => {
    const { service } = serviceWithClock();
    const fetchMock = mockFetch(async () => unsplashResponse(unsplashSearchBody([unsplashPhoto()]), { remaining: 0 }));
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    expect(await service.searchAndSelectCandidate('Ensalada')).not.toBeNull();
    expect(await service.searchAndSelectCandidate('Tacos')).toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('quota exhausted');
  });

  it('also reads the quota from error responses (429 with remaining 0)', async () => {
    const { service } = serviceWithClock();
    const fetchMock = mockFetch(async () => unsplashResponse({ errors: ['Rate Limit Exceeded'] }, { status: 429, remaining: 0 }));

    await service.searchAndSelectCandidate('Ensalada');
    await service.searchAndSelectCandidate('Tacos');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('without a reset header, keeps searches blocked for one hour and allows them again afterwards', async () => {
    const { service, clock } = serviceWithClock();
    const fetchMock = mockFetch(async () => unsplashResponse(unsplashSearchBody([unsplashPhoto()]), { remaining: 0 }));

    await service.searchAndSelectCandidate('Ensalada');
    clock.now = NOW + UNSPLASH_QUOTA_FALLBACK_COOLDOWN_MS - 1;
    await service.searchAndSelectCandidate('Tacos');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clock.now = NOW + UNSPLASH_QUOTA_FALLBACK_COOLDOWN_MS;
    expect(await service.searchAndSelectCandidate('Sopa')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('with an X-Ratelimit-Reset epoch timestamp (seconds), allows searches again at that instant', async () => {
    const { service, clock } = serviceWithClock();
    const resetAt = NOW + 10 * 60 * 1000;
    const fetchMock = mockFetch(async () =>
      unsplashResponse(unsplashSearchBody([unsplashPhoto()]), { remaining: 0, headers: { 'X-Ratelimit-Reset': String(resetAt / 1000) } }),
    );

    await service.searchAndSelectCandidate('Ensalada');
    clock.now = resetAt - 1;
    await service.searchAndSelectCandidate('Tacos');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clock.now = resetAt;
    await service.searchAndSelectCandidate('Sopa');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('with an X-Ratelimit-Reset in seconds from now, allows searches again after that delay', async () => {
    const { service, clock } = serviceWithClock();
    const fetchMock = mockFetch(async () =>
      unsplashResponse(unsplashSearchBody([unsplashPhoto()]), { remaining: 0, headers: { 'X-Ratelimit-Reset': '120' } }),
    );

    await service.searchAndSelectCandidate('Ensalada');
    clock.now = NOW + 119_999;
    await service.searchAndSelectCandidate('Tacos');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clock.now = NOW + 120_000;
    await service.searchAndSelectCandidate('Sopa');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a missing or malformed X-Ratelimit-Remaining leaves the quota state untouched', async () => {
    const { service } = serviceWithClock();
    const fetchMock = mockFetch(async () =>
      unsplashResponse(unsplashSearchBody([unsplashPhoto()]), { remaining: fetchMock.mock.calls.length === 1 ? undefined : 'abc' }),
    );

    await service.searchAndSelectCandidate('Ensalada');
    await service.searchAndSelectCandidate('Tacos');
    await service.searchAndSelectCandidate('Sopa');

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('two service instances do not share quota state', async () => {
    serviceWithClock();
    const fetchMock = mockFetch(async () => unsplashResponse(unsplashSearchBody([unsplashPhoto()]), { remaining: 0 }));
    const first = new UnsplashService(createConfigServiceMock(MOCK_API_KEY));
    const second = new UnsplashService(createConfigServiceMock(MOCK_API_KEY));

    await first.searchAndSelectCandidate('Ensalada');
    await second.searchAndSelectCandidate('Ensalada');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('UnsplashService.searchAndSelectImages - plan batch', () => {
  it('runs one search per unique normalized query, never calls download_location, and computes alt from each recipe title', async () => {
    const fetchMock = mockFetch(async () =>
      unsplashResponse(unsplashSearchBody([unsplashPhoto('eOLpJytrbsQ', { alt_description: null })])),
    );
    const days = [buildDay('2026-09-14', ['Ensalada de Quinoa', 'ENSALADA  de quinoa']), buildDay('2026-09-15', ['Tacos de Pollo'])];

    const result: any = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectImages(days);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('https://api.unsplash.com/search/photos'))).toBe(true);
    const images = result.flatMap((day: any) => day.meals.map((meal: any) => meal.recipe.image));
    expect(images.map((image: any) => image.alt)).toEqual([
      'Imagen ilustrativa de Ensalada de Quinoa',
      'Imagen ilustrativa de ENSALADA  de quinoa',
      'Imagen ilustrativa de Tacos de Pollo',
    ]);
    expect(images.every((image: any) => image.tracking.status === 'PENDING')).toBe(true);
  });

  it('never searches for a recipe that already carries an `image` key (preserved recipe, even with image: null)', async () => {
    const fetchMock = mockFetch(async () => unsplashResponse(unsplashSearchBody([unsplashPhoto()])));
    const preserved = pendingPersistedImage({ tracking: { status: 'SUCCEEDED', lastAttemptAt: '2026-10-01T00:00:00.000Z' } });
    const days = [buildDay('2026-09-14', ['Ensalada de Quinoa', 'Tacos de Pollo'])];
    days[0].meals[0].recipe.image = preserved;
    days[0].meals[1].recipe.image = null;

    const result: any = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectImages(days);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result[0].meals[0].recipe.image).toBe(preserved);
    expect((result[0].meals[1].recipe as any).image).toBeNull();
  });

  it(`never has more than ${UNSPLASH_MAX_CONCURRENT_REQUESTS} searches in flight`, async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockFetch(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return unsplashResponse(unsplashSearchBody([unsplashPhoto()]));
    });
    const days = [buildDay('2026-09-14', ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete'])];

    await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectImages(days);

    expect(maxInFlight).toBe(UNSPLASH_MAX_CONCURRENT_REQUESTS);
  });

  it('a failed search leaves only that recipe with image: null', async () => {
    mockFetch(async (url) =>
      new URL(url).searchParams.get('query')?.startsWith('tacos')
        ? unsplashResponse({ errors: ['boom'] }, { status: 500 })
        : unsplashResponse(unsplashSearchBody([unsplashPhoto()])),
    );
    const days = [buildDay('2026-09-14', ['Ensalada de Quinoa', 'Tacos de Pollo'])];

    const result: any = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).searchAndSelectImages(days);

    expect((result[0].meals[0].recipe as any).image).not.toBeNull();
    expect((result[0].meals[1].recipe as any).image).toBeNull();
  });
});

describe('UnsplashService.trackDownload - usage event after the recipe is saved', () => {
  it('requests the trackingUrl once with the Client-ID header and returns a SUCCEEDED copy without mutating its argument', async () => {
    const pending = pendingPersistedImage();
    const fetchMock = mockFetch(async () => unsplashResponse({ url: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd' }));

    const result = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).trackDownload(pending);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(pending.tracking.trackingUrl);
    expect(authorizationHeader(fetchMock.mock.calls[0][1])).toBe(`Client-ID ${MOCK_API_KEY}`);
    expect(result.tracking).toEqual({ status: 'SUCCEEDED', lastAttemptAt: expect.any(String), trackingUrl: pending.tracking.trackingUrl });
    expect(toPublicRecipeImage(result)).toEqual(toPublicRecipeImage(pending));
    expect(pending.tracking.status).toBe('PENDING');
  });

  it.each([
    ['a network error', async () => { throw new TypeError('fetch failed'); }],
    ['a 429', async () => unsplashResponse({ errors: ['Rate Limit Exceeded'] }, { status: 429 })],
    ['a 500', async () => unsplashResponse({ errors: ['boom'] }, { status: 500 })],
  ])('stores FAILED with lastAttemptAt, without throwing, on %s', async (_label, implementation) => {
    mockFetch(implementation as () => Promise<unknown>);
    const errorSpy = jest.spyOn(Logger.prototype, 'error');

    const result = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).trackDownload(pendingPersistedImage());

    expect(result.tracking.status).toBe('FAILED');
    expect(result.tracking.lastAttemptAt).not.toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('stores FAILED after UNSPLASH_TIMEOUT_MS in a single attempt', async () => {
    jest.useFakeTimers();
    const fetchMock = hangingFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    const resultPromise = new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).trackDownload(pendingPersistedImage());
    await jest.advanceTimersByTimeAsync(UNSPLASH_TIMEOUT_MS + 1000);

    expect((await resultPromise).tracking.status).toBe('FAILED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 8000);

  it.each(['https://evil.example.com/photos/x/download', 'http://api.unsplash.com/photos/x/download', 'https://api.unsplash.com@evil.example.com/x'])(
    'never sends the request (nor the key) to an unvalidated trackingUrl: %s',
    async (trackingUrl) => {
      const fetchMock = mockFetch(async () => unsplashResponse({}));

      const result = await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).trackDownload(
        pendingPersistedImage({ tracking: { trackingUrl } }),
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.tracking.status).toBe('FAILED');
    },
  );

  it('stores FAILED without calling fetch when UNSPLASH_ACCESS_KEY is missing', async () => {
    const fetchMock = mockFetch(async () => unsplashResponse({}));

    const result = await new UnsplashService(createConfigServiceMock(undefined)).trackDownload(pendingPersistedImage());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.tracking.status).toBe('FAILED');
  });

  it('logs a failure with the providerPhotoId but never the trackingUrl nor the key', async () => {
    const pending = pendingPersistedImage();
    mockFetch(async () => unsplashResponse({ errors: ['boom'] }, { status: 500 }));
    const logSpies = spyOnAllLogs();

    await new UnsplashService(createConfigServiceMock(MOCK_API_KEY)).trackDownload(pending);

    const logs = loggedText(logSpies);
    expect(logs).toContain(pending.providerPhotoId);
    expect(logs).not.toContain(pending.tracking.trackingUrl);
    expect(logs).not.toContain('/download');
    expect(logs).not.toContain(MOCK_API_KEY);
  });
});

describe('UnsplashService - no credentials nor tracking metadata in logs', () => {
  it('a full search + tracking cycle with failures at both steps never logs the key or the trackingUrl', async () => {
    const photo = unsplashPhoto();
    const service = new UnsplashService(createConfigServiceMock(MOCK_API_KEY));
    const logSpies = spyOnAllLogs();

    mockFetch(async () => unsplashResponse(unsplashSearchBody([photo]), { remaining: 0 }));
    const image = await service.searchAndSelectCandidate('Ensalada');
    await service.searchAndSelectCandidate('Tacos');
    mockFetch(async () => {
      throw new Error(`connect ECONNREFUSED ${photo.links.download_location}`);
    });
    await service.trackDownload(image!);

    const logs = loggedText(logSpies);
    expect(logs).not.toContain(MOCK_API_KEY);
    expect(logs).not.toContain(photo.links.download_location);
  });
});

describe('toPublicRecipeImage', () => {
  it.each(['PENDING', 'SUCCEEDED', 'FAILED'])('returns exactly the 9 public fields for a persisted image with tracking %s', (status) => {
    const result = toPublicRecipeImage(pendingPersistedImage({ tracking: { status, lastAttemptAt: '2026-10-03T12:00:00.000Z' } }));

    expect(Object.keys(result!).sort()).toEqual([...PUBLIC_IMAGE_KEYS].sort());
    expect(JSON.stringify(result)).not.toContain('/download');
  });

  it('returns null for null', () => {
    expect(toPublicRecipeImage(null)).toBeNull();
  });
});
