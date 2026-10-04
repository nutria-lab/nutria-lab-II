// Datos de prueba con la forma real de la respuesta de GET /search/photos de Unsplash.
import type { PersistedRecipeImage } from './recipe-image.types';

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T extends PlainObject>(base: T, overrides: PlainObject): T {
  const result: PlainObject = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key]) ? deepMerge(result[key] as PlainObject, value) : value;
  }
  return result as T;
}

const IXID = 'M3w3MjkxNzN8MHwxfHNlYXJjaHwxfHxxdWlub2ElMjBzYWxhZCUyMGZvb2QlMjByZWNpcGV8ZW58MHx8fHwxNzU5NDk4MDAwfDA';

export function unsplashPhoto(id = 'eOLpJytrbsQ', overrides: PlainObject = {}) {
  const base = {
    id,
    slug: `quinoa-salad-${id}`,
    created_at: '2023-05-10T14:35:36Z',
    updated_at: '2026-09-30T08:12:00Z',
    width: 4000,
    height: 6000,
    color: '#d9d9c0',
    blur_hash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
    likes: 128,
    description: 'Quinoa salad with roasted vegetables',
    alt_description: 'green vegetable salad in white ceramic bowl',
    urls: {
      raw: `https://images.unsplash.com/photo-1512621776951-a57141f2eefd?ixid=${IXID}&ixlib=rb-4.1.0`,
      full: `https://images.unsplash.com/photo-1512621776951-a57141f2eefd?crop=entropy&cs=srgb&fm=jpg&ixid=${IXID}&ixlib=rb-4.1.0&q=85`,
      regular: `https://images.unsplash.com/photo-1512621776951-a57141f2eefd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=${IXID}&ixlib=rb-4.1.0&q=80&w=1080`,
      small: `https://images.unsplash.com/photo-1512621776951-a57141f2eefd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=${IXID}&ixlib=rb-4.1.0&q=80&w=400`,
      thumb: `https://images.unsplash.com/photo-1512621776951-a57141f2eefd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=${IXID}&ixlib=rb-4.1.0&q=80&w=200`,
    },
    links: {
      self: `https://api.unsplash.com/photos/${id}`,
      html: `https://unsplash.com/photos/quinoa-salad-${id}`,
      download: `https://unsplash.com/photos/${id}/download?ixid=${IXID}`,
      download_location: `https://api.unsplash.com/photos/${id}/download?ixid=${IXID}`,
    },
    user: {
      id: 'Ul0QVz12Goo',
      username: 'anna_pelzer',
      name: 'Anna Pelzer',
      links: {
        self: 'https://api.unsplash.com/users/anna_pelzer',
        html: 'https://unsplash.com/@anna_pelzer',
        photos: 'https://api.unsplash.com/users/anna_pelzer/photos',
      },
    },
  };
  return deepMerge(base, overrides);
}

export function unsplashSearchBody(results: unknown[]) {
  return { total: results.length, total_pages: results.length > 0 ? 1 : 0, results };
}

// Una Response real de fetch, así headers y json() se comportan igual que en producción.
export function unsplashResponse(
  body: unknown,
  init: { status?: number; remaining?: number | string; limit?: number | string; headers?: Record<string, string> } = {},
): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...init.headers };
  headers['X-Ratelimit-Limit'] = String(init.limit ?? 50);
  if (init.remaining !== undefined) {
    headers['X-Ratelimit-Remaining'] = String(init.remaining);
  }
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status: init.status ?? 200, headers });
}

// Lo que el servicio guarda para unsplashPhoto() antes del registro de uso (PENDING).
export function pendingPersistedImage(overrides: PlainObject = {}): PersistedRecipeImage {
  const photo = unsplashPhoto();
  const base: PersistedRecipeImage = {
    provider: 'UNSPLASH',
    providerPhotoId: photo.id,
    imageUrl: photo.urls.regular,
    sourceUrl: `${photo.links.html}?utm_source=nutria&utm_medium=referral`,
    photographer: photo.user.name,
    photographerUrl: `${photo.user.links.html}?utm_source=nutria&utm_medium=referral`,
    alt: photo.alt_description,
    query: 'ensalada de quinoa food recipe',
    retrievedAt: '2026-10-03T12:00:00.000Z',
    tracking: { status: 'PENDING', lastAttemptAt: null, trackingUrl: photo.links.download_location },
  };
  return deepMerge(base as unknown as PlainObject, overrides) as unknown as PersistedRecipeImage;
}

// Mock de fetch que no responde hasta que se aborta: para probar timeouts.
export function hangingFetch() {
  return jest.fn((_url: unknown, options?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    const onAbort = () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      reject(abortError);
    };
    const signal = options?.signal;
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort);
  }));
}
