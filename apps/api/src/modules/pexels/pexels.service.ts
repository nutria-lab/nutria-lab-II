import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RecipeImage } from './recipe-image.types';
import { buildPexelsQuery } from './pexels-query.util';
import { selectPexelsCandidate } from './pexels-candidate-selector.util';
// Import de sólo tipo (erased en tiempo de compilación): no crea ninguna dependencia de
// runtime entre `modules/pexels/` y `modules/plans/`, evitando así cualquier riesgo de ciclo
// entre PexelsModule y PlansModule (plan.md sección 10.3).
import type { MealPlanDayDto } from '@/modules/plans/dto';

/**
 * Límite de concurrencia acotada para resolver imágenes de un batch de recetas
 * contra Pexels (design.md D3): nunca más de esta cantidad de llamadas en vuelo
 * simultáneamente. Constante de código, no variable de entorno (plan.md sección 8).
 */
export const PEXELS_MAX_CONCURRENT_REQUESTS = 3;

/**
 * Resuelve `resolveOne` para cada elemento de `items` con un pool acotado a
 * `PEXELS_MAX_CONCURRENT_REQUESTS` llamadas simultáneas en vuelo como máximo.
 *
 * Devuelve un array de resultados en el mismo orden que `items`, independientemente
 * del orden real de finalización de cada llamada. Un rechazo individual de
 * `resolveOne` nunca se propaga como rechazo del orquestador (defensa en profundidad;
 * `resolveImage` en sí mismo está diseñado para nunca lanzar, design.md sección 4) —
 * ese ítem simplemente queda con resultado `undefined`.
 */
export async function resolveWithBoundedConcurrency<T, R>(items: T[], resolveOne: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

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

  const workerCount = Math.min(PEXELS_MAX_CONCURRENT_REQUESTS, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());

  await Promise.all(workers);

  return results;
}

/**
 * Timeout, en milisegundos, de un único intento de request a Pexels (design.md sección 4):
 * un solo intento, sin reintentos, con `AbortController` + `setTimeout`, mismo mecanismo que
 * `gemini.service.ts` usa para su propio timeout (más corto acá: una búsqueda simple no
 * necesita el mismo presupuesto que una generación de IA).
 */
export const PEXELS_TIMEOUT_MS = 5000;

const PEXELS_SEARCH_URL = 'https://api.pexels.com/v1/search';
const PEXELS_PER_PAGE = 5;

/**
 * Adaptador de Pexels (design.md sección 1 D4, sección 4, sección 7). A diferencia de
 * `GeminiService`, se construye exitosamente sin importar si `PEXELS_API_KEY` está configurada:
 * la key se lee recién dentro de `resolveImage`, en cada intento, antes de cualquier `fetch`
 * (divergencia deliberada de D4 — Pexels es un proveedor opcional, no una dependencia dura).
 */
@Injectable()
export class PexelsService {
  private readonly logger = new Logger(PexelsService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Resuelve una única imagen de Pexels para el título de receta dado. Nunca lanza: todo
   * camino de error (key ausente, timeout, status no-200, JSON inválido, sin candidato válido)
   * termina en `null`, con a lo sumo un `warn` saneado (nunca incluye la key ni los headers
   * salientes completos — design.md sección 7).
   */
  async resolveImage(title: string): Promise<RecipeImage | null> {
    const apiKey = this.configService.get<string>('PEXELS_API_KEY');
    if (!apiKey) {
      this.logger.warn('Pexels image resolution skipped: PEXELS_API_KEY is missing or empty');
      return null;
    }

    const query = buildPexelsQuery(title);

    const url = new URL(PEXELS_SEARCH_URL);
    url.searchParams.set('query', query);
    url.searchParams.set('per_page', String(PEXELS_PER_PAGE));
    url.searchParams.set('page', '1');

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), PEXELS_TIMEOUT_MS);

    // BUG real de PR review (fix): el `AbortSignal`/timeout debe seguir vigente durante TODO el
    // tramo de red — tanto el `fetch()` inicial (headers) como la lectura del body vía
    // `response.json()` — no sólo mientras se espera el `fetch()`. Por eso `clearTimeout(timeoutId)`
    // ahora vive en un único `finally` que envuelve ambos pasos, y el `catch` que traduce
    // `AbortError` a un warning de timeout aplica por igual si el abort ocurre durante el
    // `fetch()` o mientras se espera `response.json()`.
    try {
      const response = await fetch(url.toString(), {
        headers: { Authorization: apiKey },
        signal: abortController.signal,
      });

      // 404: tratado igual que "sin resultados" — no es un evento de warning (design.md sección 4).
      if (response.status === 404) {
        return null;
      }

      // Cualquier otro status distinto de 200 (429, 5xx, etc.): fallo real del proveedor o del
      // rate limit — sí es un evento de warning, con el status recibido (nunca headers/key).
      if (response.status !== 200) {
        this.logger.warn(`Pexels responded with unexpected status ${response.status} for query="${query}"`);
        return null;
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          // El timeout disparó mientras se leía el body, no durante el `fetch()` en sí: se
          // relanza para que el `catch` externo lo trate exactamente igual que un timeout en
          // `fetch()` (mismo mensaje de warning), en vez de caer en la rama de "JSON inválido".
          throw error;
        }
        this.logger.warn(`Pexels returned an invalid (non-JSON) response body for query="${query}"`);
        return null;
      }

      const photos = (data as { photos?: unknown } | null | undefined)?.photos;
      const candidate = selectPexelsCandidate(photos);

      if (!candidate) {
        // Array vacío: "sin resultados" documentado, no es un error — sin warning.
        if (Array.isArray(photos) && photos.length === 0) {
          return null;
        }
        // `photos` no es array, o ningún elemento cumple el predicado de validez: anomalía de
        // forma del proveedor — sí es un evento de warning (design.md sección 4).
        this.logger.warn(`Pexels returned no valid image candidate for query="${query}"`);
        return null;
      }

      return {
        provider: 'PEXELS',
        providerPhotoId: String(candidate.id),
        imageUrl: candidate.src.large,
        sourceUrl: candidate.url,
        photographer: candidate.photographer,
        photographerUrl: candidate.photographer_url,
        alt: typeof candidate.alt === 'string' ? candidate.alt : '',
        query,
        retrievedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        this.logger.warn(`Pexels request timed out after ${PEXELS_TIMEOUT_MS}ms for query="${query}"`);
      } else {
        this.logger.warn(`Pexels request failed for query="${query}": ${error?.message ?? 'unknown error'}`);
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Orquestador de batch (plan.md sección 10.1/4.3, "resolveImagesForDays (o firma
   * equivalente)"): resuelve la imagen de TODA receta nueva de `days` (sin importar `origin`
   * — D1 corregido), con concurrencia acotada (D3, vía `resolveWithBoundedConcurrency`) y
   * memoización por título dentro del mismo batch (optimización recomendada por D3: si dos
   * comidas de la misma semana comparten título, sólo se dispara una llamada a Pexels).
   *
   * Sigue el mismo guard que `createDaysMealsAndRecipes` en `plans.repository.ts`
   * (`if (meal.recipe)`) para decidir a qué comidas pedirles imagen. Nunca lanza: cada
   * `resolveImage` individual ya está diseñado para no lanzar (sección 4 de design.md).
   *
   * NUT-83 revisión de reviewers - mejora barata #4: la memoización/deduplicación del batch se
   * hace por la QUERY NORMALIZADA (`buildPexelsQuery(title)`), no por el título crudo — dos
   * títulos que normalizan a la misma query (distinta capitalización, distintos acentos, etc.)
   * comparten una sola llamada real a `resolveImage`, en vez de disparar dos búsquedas
   * idénticas a Pexels (design.md D3, optimización recomendada).
   *
   * Devuelve una copia de `days` donde cada `meal.recipe` que tenía contenido trae además
   * `image: RecipeImage | null`. El tipo de retorno se deja ancho a propósito (mismo criterio
   * ya usado en `recipe.repository.ts` para otros campos no tipados del DTO) para que el
   * caller pueda pasar el resultado directamente a la persistencia sin que el excess-property
   * check de TypeScript le exija ensanchar también el tipo de `MealPlanDayDto`.
   */
  async attachImages(days: MealPlanDayDto[]): Promise<any[]> {
    // Se memoiza por query normalizada, pero se conserva un título representativo (el primero
    // visto para esa query) porque `resolveImage` recibe el título crudo, no la query ya
    // construida — `buildPexelsQuery` es idempotente, así que resolver con cualquiera de los
    // títulos que comparten query produce el mismo resultado.
    const titleByQuery = new Map<string, string>();
    for (const day of days) {
      for (const meal of day.meals) {
        if (meal.recipe) {
          const normalizedQuery = buildPexelsQuery(meal.recipe.title);
          if (!titleByQuery.has(normalizedQuery)) {
            titleByQuery.set(normalizedQuery, meal.recipe.title);
          }
        }
      }
    }

    const uniqueQueries = Array.from(titleByQuery.keys());
    const resolvedList = await resolveWithBoundedConcurrency(uniqueQueries, (normalizedQuery) =>
      this.resolveImage(titleByQuery.get(normalizedQuery) as string),
    );

    const resolvedByQuery = new Map<string, RecipeImage | null>();
    uniqueQueries.forEach((normalizedQuery, index) => {
      resolvedByQuery.set(normalizedQuery, resolvedList[index] ?? null);
    });

    return days.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => {
        if (!meal.recipe) {
          return meal;
        }
        return {
          ...meal,
          recipe: {
            ...meal.recipe,
            image: resolvedByQuery.get(buildPexelsQuery(meal.recipe.title)) ?? null,
          },
        };
      }),
    }));
  }
}
