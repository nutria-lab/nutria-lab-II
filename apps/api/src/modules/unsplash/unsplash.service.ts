import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RecipeImage, PersistedRecipeImage } from './recipe-image.types';
import { buildUnsplashQuery } from './unsplash-query.util';
import { selectUnsplashCandidate, type UnsplashCandidate } from './unsplash-candidate-selector.util';
import { isValidUnsplashUrl, UNSPLASH_API_HOST } from './unsplash-url-validator.util';
// Import sólo de tipo: evita una dependencia circular en runtime con el módulo de planes.
import type { MealPlanDayDto } from '@/modules/plans/dto';

// Máximo de llamadas simultáneas a Unsplash (la cuota es por key, no por receta).
export const UNSPLASH_MAX_CONCURRENT_REQUESTS = 3;

// Ejecuta resolveOne sobre todos los items con a lo sumo 3 a la vez y devuelve los resultados en
// el mismo orden. Si un item falla, su resultado queda undefined en vez de romper todo el lote.
export async function resolveWithBoundedConcurrency<T, R>(items: T[], resolveOne: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  // Cada worker toma el siguiente item libre hasta que no quedan más.
  async function worker(): Promise<void> {
    for (;;) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      try {
        results[currentIndex] = await resolveOne(items[currentIndex]);
      } catch {
        results[currentIndex] = undefined as unknown as R;
      }
    }
  }

  const workerCount = Math.min(UNSPLASH_MAX_CONCURRENT_REQUESTS, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());

  await Promise.all(workers);

  return results;
}

// Un solo intento por llamada; pasado este tiempo se aborta y se sigue sin imagen.
export const UNSPLASH_TIMEOUT_MS = 5000;

// Si la cuota llega a 0 y Unsplash no dice cuándo se renueva, se espera 1 hora.
export const UNSPLASH_QUOTA_FALLBACK_COOLDOWN_MS = 60 * 60 * 1000;

const UNSPLASH_SEARCH_URL = 'https://api.unsplash.com/search/photos';
const UNSPLASH_PER_PAGE = 5;

// Un reset >= este valor es un timestamp epoch en segundos; uno menor, segundos desde ahora.
const EPOCH_SECONDS_THRESHOLD = 1_000_000_000;

type SearchResult = { query: string; candidate: UnsplashCandidate };

// Agrega la UTM de atribución que pide Unsplash conservando los demás parámetros.
// `set` reemplaza un utm_* que ya existiera en vez de duplicarlo.
function withAttributionUtm(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('utm_source', 'nutria');
  parsed.searchParams.set('utm_medium', 'referral');
  return parsed.toString();
}

// Lee un header sin romperse si la respuesta no trae headers (por ejemplo, un mock de test).
function readHeader(response: Response, name: string): string | null {
  const value = (response as unknown as { headers?: { get?: (header: string) => string | null } }).headers?.get?.(name);
  return typeof value === 'string' ? value : null;
}

// Convierte la imagen guardada en la que se devuelve al cliente: copia sólo los 9 campos
// públicos, así la metadata privada de tracking nunca sale en una respuesta.
export function toPublicRecipeImage(persisted: PersistedRecipeImage | null): RecipeImage | null {
  if (!persisted) {
    return null;
  }
  return {
    provider: persisted.provider,
    providerPhotoId: persisted.providerPhotoId,
    imageUrl: persisted.imageUrl,
    sourceUrl: persisted.sourceUrl,
    photographer: persisted.photographer,
    photographerUrl: persisted.photographerUrl,
    alt: persisted.alt,
    query: persisted.query,
    retrievedAt: persisted.retrievedAt,
  };
}

// Adaptador de Unsplash. Nunca lanza excepciones: ante cualquier problema devuelve null o FAILED,
// para que crear recetas y planes no dependa de Unsplash. La key se lee en cada llamada.
@Injectable()
export class UnsplashService {
  private readonly logger = new Logger(UnsplashService.name);

  // Hasta cuándo no se busca porque la cuota está agotada (null = hay cuota). Vive en memoria.
  private quotaExhaustedUntil: number | null = null;

  constructor(private readonly configService: ConfigService) {}

  // Para POST /recipes: busca la foto de una receta y la devuelve lista para guardar, con el
  // tracking en PENDING. No registra el uso: eso se hace después de guardar (trackDownload).
  async searchAndSelectCandidate(title: string): Promise<PersistedRecipeImage | null> {
    const result = await this.searchCandidate(title);
    return result ? this.buildPendingImage(result, title) : null;
  }

  // Para planes: le agrega `image` a cada receta del plan. Hace una sola búsqueda por query
  // (títulos que normalizan igual comparten foto) y no busca para las recetas que ya traen
  // la clave `image` (las que el PUT conserva de la base).
  async searchAndSelectImages(days: MealPlanDayDto[]): Promise<MealPlanDayDto[]> {
    const needsImage = (recipe: MealPlanDayDto['meals'][number]['recipe']) => Boolean(recipe) && !('image' in recipe);

    // 1. Juntar las queries distintas (con el primer título que produjo cada una).
    const titleByQuery = new Map<string, string>();
    for (const day of days) {
      for (const meal of day.meals) {
        if (needsImage(meal.recipe)) {
          const normalizedQuery = buildUnsplashQuery(meal.recipe.title);
          if (!titleByQuery.has(normalizedQuery)) {
            titleByQuery.set(normalizedQuery, meal.recipe.title);
          }
        }
      }
    }

    // 2. Buscar cada query una sola vez, de a 3 en paralelo.
    const uniqueQueries = Array.from(titleByQuery.keys());
    const results = await resolveWithBoundedConcurrency(uniqueQueries, (normalizedQuery) =>
      this.searchCandidate(titleByQuery.get(normalizedQuery) as string),
    );

    const resultByQuery = new Map<string, SearchResult | null>();
    uniqueQueries.forEach((normalizedQuery, index) => {
      resultByQuery.set(normalizedQuery, results[index] ?? null);
    });

    // 3. Armar la imagen de cada receta con su propio título (el alt de respaldo usa el título).
    return days.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => {
        if (!needsImage(meal.recipe)) {
          return meal;
        }
        const resolved = resultByQuery.get(buildUnsplashQuery(meal.recipe.title));
        return {
          ...meal,
          recipe: {
            ...meal.recipe,
            image: resolved ? this.buildPendingImage(resolved, meal.recipe.title) : null,
          },
        };
      }),
    }));
  }

  // Registra en Unsplash el uso de una foto ya guardada con su receta (llamando a download_location).
  // Devuelve una copia de la imagen con el tracking en SUCCEEDED o FAILED; nunca lanza.
  async trackDownload(persisted: PersistedRecipeImage): Promise<PersistedRecipeImage> {
    const { trackingUrl } = persisted.tracking;
    const withStatus = (status: 'SUCCEEDED' | 'FAILED'): PersistedRecipeImage => ({
      ...persisted,
      tracking: { ...persisted.tracking, status, lastAttemptAt: new Date().toISOString() },
    });

    // La URL viene de la base: se vuelve a validar antes de mandarle la key.
    if (!isValidUnsplashUrl(trackingUrl, UNSPLASH_API_HOST)) {
      this.logger.error(
        `Unsplash download tracking skipped for providerPhotoId=${persisted.providerPhotoId}: tracking URL failed host validation`,
      );
      return withStatus('FAILED');
    }

    const apiKey = this.configService.get<string>('UNSPLASH_ACCESS_KEY');
    if (!apiKey) {
      this.logger.warn(
        `Unsplash download tracking skipped: UNSPLASH_ACCESS_KEY is missing or empty (providerPhotoId=${persisted.providerPhotoId})`,
      );
      return withStatus('FAILED');
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), UNSPLASH_TIMEOUT_MS);

    try {
      const response = await fetch(trackingUrl, {
        headers: { Authorization: `Client-ID ${apiKey}` },
        signal: abortController.signal,
      });

      // fetch() no falla con un status de error (4xx/5xx): hay que revisarlo a mano.
      if (!response.ok) {
        this.logger.error(
          `Unsplash download tracking failed for providerPhotoId=${persisted.providerPhotoId}: received status ${response.status}`,
        );
        return withStatus('FAILED');
      }

      return withStatus('SUCCEEDED');
    } catch (error: any) {
      // Timeout o error de red. Nunca se loguea la URL ni la key.
      const reason = error?.name === 'AbortError' ? `timed out after ${UNSPLASH_TIMEOUT_MS}ms` : 'request failed';
      this.logger.error(`Unsplash download tracking ${reason} for providerPhotoId=${persisted.providerPhotoId}`);
      return withStatus('FAILED');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Hace la búsqueda en Unsplash y elige el primer candidato válido. Devuelve null si falta la
  // key, si la cuota está agotada, si no hay resultados o ante cualquier error del proveedor.
  private async searchCandidate(title: string): Promise<SearchResult | null> {
    const apiKey = this.configService.get<string>('UNSPLASH_ACCESS_KEY');
    if (!apiKey) {
      this.logger.warn('Unsplash image resolution skipped: UNSPLASH_ACCESS_KEY is missing or empty');
      return null;
    }

    const query = buildUnsplashQuery(title);

    if (this.isQuotaExhausted()) {
      this.logger.warn(
        `Unsplash quota exhausted until ${new Date(this.quotaExhaustedUntil as number).toISOString()}, skipping search for query="${query}"`,
      );
      return null;
    }

    const url = new URL(UNSPLASH_SEARCH_URL);
    url.searchParams.set('query', query);
    url.searchParams.set('page', '1');
    url.searchParams.set('per_page', String(UNSPLASH_PER_PAGE));
    url.searchParams.set('order_by', 'relevant');
    url.searchParams.set('content_filter', 'high');

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), UNSPLASH_TIMEOUT_MS);

    // Un solo try/finally para fetch() y json(): el timeout también cubre la lectura del body.
    try {
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Client-ID ${apiKey}` },
        signal: abortController.signal,
      });

      this.applyQuotaFromResponse(response);

      if (response.status !== 200) {
        // 401/403 = key inválida o sin permisos: mensaje propio para detectarlo en los logs.
        if (response.status === 401 || response.status === 403) {
          this.logger.warn(`Unsplash configuration appears invalid (status ${response.status}) for query="${query}"`);
        } else {
          this.logger.warn(`Unsplash responded with unexpected status ${response.status} for query="${query}"`);
        }
        return null;
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          // Timeout mientras se leía el body: se trata igual que un timeout de fetch() (catch de abajo).
          throw error;
        }
        this.logger.warn(`Unsplash returned an invalid (non-JSON) response body for query="${query}"`);
        return null;
      }

      const results = (data as { results?: unknown } | null | undefined)?.results;
      const candidate = selectUnsplashCandidate(results);

      if (!candidate) {
        // Sin resultados es normal (no se loguea); resultados sin ningún candidato válido, no.
        if (!(Array.isArray(results) && results.length === 0)) {
          this.logger.warn(`Unsplash returned no valid image candidate for query="${query}"`);
        }
        return null;
      }

      return { query, candidate };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        this.logger.warn(`Unsplash request timed out after ${UNSPLASH_TIMEOUT_MS}ms for query="${query}"`);
      } else {
        this.logger.warn(`Unsplash request failed for query="${query}": ${error?.message ?? 'unknown error'}`);
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ¿Hay que saltear la búsqueda por cuota agotada? Al pasar la hora de reset se vuelve a habilitar.
  private isQuotaExhausted(): boolean {
    if (this.quotaExhaustedUntil === null) {
      return false;
    }
    if (Date.now() >= this.quotaExhaustedUntil) {
      this.quotaExhaustedUntil = null;
      return false;
    }
    return true;
  }

  // Actualiza el estado de cuota con cada respuesta de búsqueda (también las de error).
  // Si el header falta o no es un número válido, no cambia nada.
  private applyQuotaFromResponse(response: Response): void {
    const remainingHeader = readHeader(response, 'X-Ratelimit-Remaining');
    if (remainingHeader === null) {
      return;
    }
    const remaining = Number.parseInt(remainingHeader, 10);
    if (!Number.isInteger(remaining) || remaining < 0) {
      return;
    }
    this.quotaExhaustedUntil = remaining === 0 ? this.resolveQuotaResetAt(response) : null;
  }

  // Hasta cuándo bloquear: lo que diga X-Ratelimit-Reset, o 1 hora si no viene (Unsplash hoy no lo manda).
  private resolveQuotaResetAt(response: Response): number {
    const now = Date.now();
    const resetHeader = readHeader(response, 'X-Ratelimit-Reset');
    const reset = resetHeader === null ? Number.NaN : Number.parseInt(resetHeader, 10);

    if (Number.isInteger(reset) && reset > 0) {
      const resetAt = reset >= EPOCH_SECONDS_THRESHOLD ? reset * 1000 : now + reset * 1000;
      if (resetAt > now) {
        return resetAt;
      }
    }
    return now + UNSPLASH_QUOTA_FALLBACK_COOLDOWN_MS;
  }

  // Arma la imagen que se guarda en Recipe.image: los 9 campos públicos + tracking en PENDING.
  // imageUrl se guarda tal cual (con ixid); sólo los enlaces de atribución llevan UTM.
  private buildPendingImage({ candidate, query }: SearchResult, title: string): PersistedRecipeImage {
    const alt =
      typeof candidate.alt_description === 'string' && candidate.alt_description.length > 0
        ? candidate.alt_description
        : `Imagen ilustrativa de ${title}`;

    return {
      provider: 'UNSPLASH',
      providerPhotoId: candidate.id,
      imageUrl: candidate.urls.regular,
      sourceUrl: withAttributionUtm(candidate.links.html),
      photographer: candidate.user.name,
      photographerUrl: withAttributionUtm(candidate.user.links.html),
      alt,
      query,
      retrievedAt: new Date().toISOString(),
      tracking: { status: 'PENDING', lastAttemptAt: null, trackingUrl: candidate.links.download_location },
    };
  }
}
