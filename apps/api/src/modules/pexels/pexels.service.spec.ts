/**
 * Contract under test (does not exist yet — this is the failing-red step of TDD, task NUT-83
 * etapa 2 — see .plans/nut-83-encontrar-una-imagen-confiable-para-cada-receta-nueva/{design,plan}.md):
 *
 *   apps/api/src/modules/plans/pexels/pexels.service.ts
 *     - export const PEXELS_TIMEOUT_MS (design.md section 4: 5000ms, single attempt, no retries)
 *     - export class PexelsService, @Injectable(), constructor(configService: ConfigService)
 *       (same DI pattern as GeminiService — see gemini.service.ts:34-45 — but, per design.md D4
 *       and plan.md section 6, it must NOT read/validate PEXELS_API_KEY in the constructor: it
 *       must construct successfully with no key configured, and read the key inside
 *       resolveImage() on every call, before any fetch)
 *     - PexelsService.resolveImage(title: string): Promise<RecipeImage | null>
 *
 *   apps/api/src/modules/plans/pexels/recipe-image.types.ts
 *     - export type RecipeImage (design.md section 8 / plan.md section 3: the shared DTO type,
 *       kept in its own file so pexels-candidate-selector.util.ts, pexels.service.ts and
 *       plans.repository.ts can all import it without pulling in the full service)
 *
 * Neither file currently exports any of this (pexels.service.ts today only has
 * PEXELS_MAX_CONCURRENT_REQUESTS / resolveWithBoundedConcurrency from the previous stage, and
 * recipe-image.types.ts does not exist at all), so this spec is expected to fail red with a
 * "Cannot find module ./recipe-image.types" / missing export error, per the task instructions.
 *
 * This spec mocks `global.fetch` and `ConfigService.get` — it never performs a real network
 * request. It covers, per design.md section 4 (resilience table) and section 6 (AC3-AC9, AC12):
 *   1. 200 with a valid candidate (AC3) — full RecipeImage mapping + exact outgoing request.
 *   2. 200 with `photos: []` (AC4) — null, no warning.
 *   3. Missing/empty API key (AC5) — no fetch call at all, exactly one sanitized warning.
 *   4. Timeout (AC6) — fake timers, single attempt, sanitized warning.
 *   5. 429 (AC7) — null, no retry, warning mentions status 429.
 *   6. 5xx (AC8) — null, no retry, warning mentions the received status.
 *   7. Invalid JSON body on a 200 (AC9, adapter half) — null, never throws out of resolveImage,
 *      warning indicates an invalid response.
 *   8. 404 (design.md section 4 table) — null, logged like "no results" (no warning, at most
 *      debug) — NOT treated like 429/5xx.
 *   9. AC12 (key never leaked in any failure-path log): asserted inline as part of tests 3-8
 *      above, rather than as one extra consolidated test. Rationale for that choice (documented
 *      per the task instructions, which leave this to the tester's judgment): each failure
 *      scenario already needs its own distinct fetch/response mock and its own specific warning
 *      content assertion (missing-key wording vs. timeout wording vs. "429" vs. the exact 5xx
 *      status vs. "invalid response" vs. no-warning-at-all for 404) — bolting a single extra
 *      "AC12 covers everything" test on top would either duplicate all of those six mocks a
 *      second time for no added signal, or fall back to a shallower check than what each
 *      dedicated test already performs with a concrete, known-shape response. A shared
 *      `assertApiKeyNeverLeaked` helper (below) is called from inside every scenario that
 *      actually reaches a point where the real key was used (tests 4-8; test 3 never uses the
 *      key at all since fetch is never called), which gives AC12 the same coverage as a
 *      standalone test without the duplication.
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PexelsService, PEXELS_TIMEOUT_MS } from './pexels.service';
import type { RecipeImage } from './recipe-image.types';
import { buildPexelsQuery } from './pexels-query.util';

/** Recognizable mock key value used across every scenario (per task instructions, item 3). */
const MOCK_API_KEY = 'test-pexels-key-12345';

function createConfigServiceMock(apiKeyValue: string | undefined) {
  return {
    get: jest.fn((key: string) => {
      if (key === 'PEXELS_API_KEY') {
        return apiKeyValue;
      }
      return undefined;
    }),
  } as unknown as ConfigService;
}

/** Reads an Authorization-style header off a fetch call's `options.headers`, whatever shape
 * (plain object, Headers instance, or array of tuples) the real implementation ends up using. */
function getHeaderValue(headers: unknown, name: string): string | null | undefined {
  if (!headers) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found?.[1];
  }
  const record = headers as Record<string, string>;
  const matchKey = Object.keys(record).find((key) => key.toLowerCase() === name.toLowerCase());
  return matchKey ? record[matchKey] : undefined;
}

/** Fails the test if `apiKey` appears, verbatim, in any argument of any call recorded by
 * `warnSpy` (or any other passed logger spy) — AC12 / design.md section 7. */
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

describe('PexelsService.resolveImage', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('(AC3) maps a 200 response with a valid candidate into a full RecipeImage, and calls fetch with the normalized query, per_page=5, and an unprefixed Authorization header', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const title = '  Ñoquis   de\tPapá  ';
    const expectedQuery = buildPexelsQuery(title);

    const validCandidate = {
      id: 998877,
      src: { large: 'https://images.pexels.com/photos/998877/pexels-photo-998877-large.jpeg' },
      url: 'https://www.pexels.com/photo/998877/',
      photographer: 'Jane Doe',
      photographer_url: 'https://www.pexels.com/@jane-doe',
      alt: 'Ñoquis de papa served on a white plate',
      width: 1920,
      height: 1280,
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ photos: [validCandidate] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new PexelsService(configService);

    const result = (await service.resolveImage(title)) as RecipeImage;

    expect(result).not.toBeNull();
    expect(result.provider).toBe('PEXELS');
    expect(result.providerPhotoId).toBe(String(validCandidate.id));
    expect(result.imageUrl).toBe(validCandidate.src.large);
    expect(result.sourceUrl).toBe(validCandidate.url);
    expect(result.photographer).toBe(validCandidate.photographer);
    expect(result.photographerUrl).toBe(validCandidate.photographer_url);
    expect(result.alt).toBe(validCandidate.alt);
    expect(result.query).toBe(expectedQuery);
    expect(new Date(result.retrievedAt).toISOString()).toBe(result.retrievedAt);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
    const urlObj = new URL(String(calledUrl));
    expect(urlObj.searchParams.get('query')).toBe(expectedQuery);
    expect(urlObj.searchParams.get('per_page')).toBe('5');
    expect(getHeaderValue(calledOptions?.headers, 'Authorization')).toBe(MOCK_API_KEY);
  });

  it('(AC4) returns null without calling any warning-level log when Pexels responds 200 with an empty photos array', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ photos: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new PexelsService(configService);
    const result = await service.resolveImage('Pasta Carbonara');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('(AC5) never calls fetch and emits exactly one sanitized warning when PEXELS_API_KEY is missing/empty', async () => {
    const configService = createConfigServiceMock(undefined);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new PexelsService(configService);
    const result = await service.resolveImage('Pasta Carbonara');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Nothing related to a configured key exists in this scenario, but the warning payload
    // itself must never contain anything resembling a secret value either.
    assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
  });

  it('(AC5 bis) also returns null with no fetch call when PEXELS_API_KEY is configured as an empty string', async () => {
    const configService = createConfigServiceMock('');
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new PexelsService(configService);
    const result = await service.resolveImage('Pasta Carbonara');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('(AC6) makes exactly one attempt (no retry) and returns null with a timeout warning when Pexels never responds within PEXELS_TIMEOUT_MS, never leaking the key', async () => {
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
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener('abort', onAbort);
          }
        }
        // Never resolves/rejects on its own otherwise — only the abort path settles it.
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new PexelsService(configService);
    const resultPromise = service.resolveImage('Pasta Carbonara');

    await jest.advanceTimersByTimeAsync(PEXELS_TIMEOUT_MS + 1000);

    const result = await resultPromise;

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
  });

  it('(AC7) returns null without retrying and logs a warning mentioning status 429 when Pexels rate-limits the request, never leaking the key', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too Many Requests' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new PexelsService(configService);
    const result = await service.resolveImage('Pasta Carbonara');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    const loggedSomething429 = warnSpy.mock.calls.some((call) =>
      call.some((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)).includes('429')),
    );
    expect(loggedSomething429).toBe(true);
    assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
  });

  it('(AC8) returns null without retrying and logs a warning mentioning the received 5xx status, never leaking the key', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Service Unavailable' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new PexelsService(configService);
    const result = await service.resolveImage('Pasta Carbonara');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    const loggedStatus = warnSpy.mock.calls.some((call) =>
      call.some((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)).includes('503')),
    );
    expect(loggedStatus).toBe(true);
    assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
  });

  it('(AC9 adapter) returns null without throwing out of resolveImage and logs an invalid-response warning when the 200 body is not valid JSON, never leaking the key', async () => {
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

    const service = new PexelsService(configService);

    await expect(service.resolveImage('Pasta Carbonara')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
  });

  it('(design.md section 4 table) returns null on a 404 response, logged the same way as "no results" (no warning-level log), unlike 429/5xx', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not Found' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new PexelsService(configService);
    const result = await service.resolveImage('Pasta Carbonara');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  /**
   * BUG bloqueante real reportado en una revisión externa de PR sobre este mismo archivo
   * (`pexels.service.ts`): `clearTimeout(timeoutId)` corre en el bloque `finally` que envuelve
   * únicamente el `await fetch(...)` (líneas ~103-118 de la implementación actual) — es decir,
   * apenas llegan los HEADERS de la respuesta. `response.json()` (la lectura del BODY, que puede
   * tardar) corre DESPUÉS de ese `finally`, ya sin ninguna protección de timeout: el
   * `AbortController` nunca se vuelve a armar para la lectura del body, así que si el proveedor
   * manda los headers rápido y después se cuelga mandando el body, `resolveImage()` puede
   * quedarse esperando para siempre.
   *
   * Este test simula exactamente ese escenario: `fetch()` resuelve rápido con
   * `{ ok: true, status: 200 }` (headers ya llegaron), pero el `.json()` de esa respuesta
   * devuelve una promesa que nunca se resuelve ni rechaza por sí sola — sólo lo hace si el mismo
   * `AbortSignal` que la implementación le pasa a `fetch()` llega a abortarse (mismo criterio ya
   * usado en el test de AC6 de arriba para el timeout de `fetch()` en sí). Como el bug cancela
   * ese abort apenas `fetch()` resuelve, avanzar los fake timers más allá de `PEXELS_TIMEOUT_MS`
   * NO debería disparar el abort contra la implementación actual, así que `.json()` se queda
   * colgado para siempre y `resolveImage(...)` nunca resuelve a `null` — el `await` de abajo
   * cuelga hasta el timeout del propio test (acotado explícitamente a 8000ms reales para que
   * falle en rojo de forma determinística en vez de colgar la suite indefinidamente).
   *
   * Se espera que este test falle en ROJO contra la implementación actual (timeout del test
   * runner esperando `resultPromise`, o quedando pendiente/never-resolved), y que quede en VERDE
   * una vez que la implementación arme el timeout de forma que también cubra la lectura del
   * body (`response.json()`), no sólo el `fetch()` inicial.
   */
  it('(BUG real de PR review) resolveImage no debe colgarse para siempre si fetch() resuelve rápido (llegan headers) pero response.json() se cuelga leyendo el body más allá de PEXELS_TIMEOUT_MS', async () => {
    jest.useFakeTimers();
    const configService = createConfigServiceMock(MOCK_API_KEY);

    const fetchMock = jest.fn((_url: unknown, options?: { signal?: AbortSignal }) => {
      const signal = options?.signal;
      // Los headers llegan rápido: fetch() en sí resuelve de inmediato con ok/status, sin pasar
      // por el AbortSignal en absoluto (a diferencia del test de AC6, donde el propio fetch()
      // era el que se colgaba).
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
              if (signal.aborted) {
                onAbort();
              } else {
                signal.addEventListener('abort', onAbort);
              }
            }
            // Nunca se resuelve/rechaza por sí sola en ningún otro caso: la lectura del body se
            // cuelga para siempre a menos que el AbortSignal original de fetch() se aborte
            // mientras esta promesa sigue pendiente.
          }),
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    const service = new PexelsService(configService);
    const resultPromise = service.resolveImage('Pasta Carbonara');

    await jest.advanceTimersByTimeAsync(PEXELS_TIMEOUT_MS + 1000);

    const result = await resultPromise;

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    assertApiKeyNeverLeaked([warnSpy], MOCK_API_KEY);
  }, 8000);
});

/**
 * NUT-83 revisión de reviewers - mejora barata #4: memoización por query NORMALIZADA, no por
 * título crudo. `attachImages` hoy memoiza con `Array.from(new Set(titles))` sobre
 * `meal.recipe.title` tal cual (el string crudo, sin pasar por `buildPexelsQuery`). Dos
 * recetas cuyos títulos normalizan a la MISMA query (ej. distinta capitalización, o distintos
 * acentos) son, para `buildPexelsQuery`, literalmente la misma búsqueda — pero hoy, al
 * memoizar por título crudo, se tratan como dos búsquedas distintas y disparan dos llamadas
 * de red idénticas a Pexels para el mismo resultado. design.md D3 (optimización recomendada,
 * no obligatoria para los AC de este ticket, pero barata de arreglar) pide explícitamente
 * memoizar por la query normalizada "para que si dos comidas de la misma semana generan el
 * mismo título de receta [en el sentido de normalizar igual], no se dispare una segunda
 * llamada idéntica a Pexels".
 *
 * Este test debe fallar en rojo hasta que el implementer cambie la clave de deduplicación de
 * `attachImages` de `meal.recipe.title` crudo a `buildPexelsQuery(meal.recipe.title)`.
 */
describe('PexelsService.attachImages - memoización por query normalizada (D3, mejora barata)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('dos recetas cuyos títulos normalizan a la MISMA query (distinta capitalización) disparan UNA sola llamada real a fetch, no dos', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const validCandidate = {
      id: 1,
      src: { large: 'https://images.pexels.com/photos/1/pexels-photo-1-large.jpeg' },
      url: 'https://www.pexels.com/photo/1/',
      photographer: 'Jane Doe',
      photographer_url: 'https://www.pexels.com/@jane-doe',
      alt: 'Tacos de pollo servidos en un plato',
      width: 1920,
      height: 1280,
    };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ photos: [validCandidate] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new PexelsService(configService);

    // "Tacos de Pollo" y "tacos de pollo" son títulos CRUDOS distintos (case distinto), pero
    // buildPexelsQuery los normaliza a exactamente la misma query ("tacos de pollo food
    // recipe") — deben resolver con una única llamada real a Pexels, no dos.
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
