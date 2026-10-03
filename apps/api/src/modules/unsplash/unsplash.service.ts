import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RecipeImage, PersistedRecipeImage } from './recipe-image.types';
import { buildUnsplashQuery } from './unsplash-query.util';
import { selectUnsplashCandidate, type UnsplashCandidate } from './unsplash-candidate-selector.util';
import { isValidUnsplashUrl, UNSPLASH_API_HOST } from './unsplash-url-validator.util';
// Type-only import: no runtime dependency between modules/unsplash and modules/plans, so no
// risk of a circular module import (plan.md 10.3/11.2).
import type { MealPlanDayDto } from '@/modules/plans/dto';

// Bounded concurrency limit for resolving a batch of images (design.md D3). Code constant, not
// an env var (plan.md section 8).
export const UNSPLASH_MAX_CONCURRENT_REQUESTS = 3;

// Generic bounded-concurrency pool, no provider knowledge. A resolveOne rejection never
// propagates out of the orchestrator (defense in depth - resolveImage itself never throws).
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

  const workerCount = Math.min(UNSPLASH_MAX_CONCURRENT_REQUESTS, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());

  await Promise.all(workers);

  return results;
}

// Single-attempt timeout in ms (design.md section 4/11.2): AbortController + setTimeout, no
// retries, same mechanism as GeminiService's own timeout.
export const UNSPLASH_TIMEOUT_MS = 5000;

const UNSPLASH_SEARCH_URL = 'https://api.unsplash.com/search/photos';
const UNSPLASH_PER_PAGE = 5;

// Attribution UTM on sourceUrl/photographerUrl (design.md 12.4) - `set` replaces rather than
// duplicates a pre-existing utm_source/utm_medium, leaving any other query param untouched.
// imageUrl never goes through this: it's persisted byte-for-byte as urls.regular.
function withAttributionUtm(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('utm_source', 'nutria');
  parsed.searchParams.set('utm_medium', 'referral');
  return parsed.toString();
}

// Single public-mapping function (design.md 12.5.1), reused by every read/write path that ever
// responds to a client: explicit whitelist of the 9 public fields, never spread+destructure, so
// a future private field added to PersistedRecipeImage can't leak here by accident.
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

// Unlike GeminiService, this adapter must construct successfully regardless of whether
// UNSPLASH_ACCESS_KEY is set (D4): the key is read on each attempt, inside resolveImage, never
// in the constructor.
@Injectable()
export class UnsplashService {
  private readonly logger = new Logger(UnsplashService.name);

  // In-memory, per-instance quota state (design.md 12.7). `null` = not observed yet, treated as
  // available since that's the legitimate state of a freshly started process. Updated from every
  // search response (200 or error) and consulted before the NEXT search attempt only - the call
  // that reported 0 already used the quota it consumed.
  private quotaRemaining: number | null = null;

  constructor(private readonly configService: ConfigService) {}

  // Overwrites quotaRemaining from X-Ratelimit-Remaining when present and a valid non-negative
  // integer; otherwise leaves existing state untouched (design.md 12.7 step 2).
  private applyQuotaFromResponse(response: Response): void {
    const header = (response as unknown as { headers?: { get?: (name: string) => string | null } }).headers?.get?.(
      'X-Ratelimit-Remaining',
    );
    if (typeof header !== 'string') {
      return;
    }
    const parsed = Number.parseInt(header, 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      this.quotaRemaining = parsed;
    }
  }

  // Legacy single-call convenience (used by RecipeService.create's callers that don't care about
  // the PENDING/SUCCEEDED/FAILED split): search+select then immediately track, same cadence as
  // before the ciclo B split, returning the public 9-field shape only.
  async resolveImage(title: string): Promise<RecipeImage | null> {
    const persisted = await this.searchAndSelectCandidate(title);
    if (!persisted) {
      return null;
    }
    const tracked = await this.trackDownload(persisted);
    return toPublicRecipeImage(tracked);
  }

  // Ciclo B (design.md 12.5.2 paso 1, plan.md 12.1.3.b): search + candidate selection only - no
  // tracking fetch. Returns the full PersistedRecipeImage already built (public fields + a
  // `tracking` namespace set to PENDING with `trackingUrl: candidate.links.download_location`),
  // ready to be persisted by the caller BEFORE the tracking fetch is ever attempted.
  async searchAndSelectCandidate(title: string): Promise<PersistedRecipeImage | null> {
    const raw = await this.searchAndSelectCandidateRaw(title);
    if (!raw) {
      return null;
    }
    return {
      ...this.buildRecipeImage(raw.candidate, raw.query, title),
      tracking: {
        status: 'PENDING',
        lastAttemptAt: null,
        trackingUrl: raw.candidate.links.download_location,
      },
    };
  }

  // Shared by resolveImage/searchAndSelectCandidate and attachImages: search + candidate
  // selection only, cacheable per normalized query (bug fix, design.md 11.2) - deliberately
  // stops short of the per-recipe alt fallback, which depends on the title of the recipe
  // actually being rendered, not whichever title first produced this query. No tracking call
  // happens here (design.md 12.5.2): that is always the caller's own, separate step.
  private async searchAndSelectCandidateRaw(title: string): Promise<{ query: string; candidate: UnsplashCandidate } | null> {
    const apiKey = this.configService.get<string>('UNSPLASH_ACCESS_KEY');
    if (!apiKey) {
      this.logger.warn('Unsplash image resolution skipped: UNSPLASH_ACCESS_KEY is missing or empty');
      return null;
    }

    const query = buildUnsplashQuery(title);

    // Cut-off for the NEXT call only (design.md 12.7 step 1) - skip the fetch entirely once a
    // prior response told us the quota is already at zero.
    if (this.quotaRemaining === 0) {
      this.logger.warn(`Unsplash quota exhausted, skipping search for query="${query}"`);
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

    // The AbortSignal must stay live across both fetch() and response.json() (regression fixed
    // for Pexels, same mechanism required here - design.md 11.2), so clearTimeout lives in a
    // single finally wrapping both steps.
    try {
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Client-ID ${apiKey}` },
        signal: abortController.signal,
      });

      this.applyQuotaFromResponse(response);
      this.logger.warn(`[DEMO] X-Ratelimit-Limit=${response.headers.get('X-Ratelimit-Limit')} X-Ratelimit-Remaining=${response.headers.get('X-Ratelimit-Remaining')}`);

      if (response.status !== 200) {
        // 401/403 means the credential itself is wrong, not a transient provider issue (design.md
        // 12.7) - distinct message so this category is identifiable in logs, key never included.
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
          // Timeout fired while reading the body, not during fetch() itself - rethrow so the
          // outer catch treats it exactly like a fetch()-time timeout.
          throw error;
        }
        this.logger.warn(`Unsplash returned an invalid (non-JSON) response body for query="${query}"`);
        return null;
      }

      const results = (data as { results?: unknown } | null | undefined)?.results;
      const candidate = selectUnsplashCandidate(results);

      if (!candidate) {
        if (Array.isArray(results) && results.length === 0) {
          return null;
        }
        this.logger.warn(`Unsplash returned no valid image candidate for query="${query}"`);
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

  // Builds the public RecipeImage for one recipe. `title` is that recipe's own title, not
  // necessarily the one that produced `candidate`/`query` (bug fix, design.md 11.2): the alt
  // fallback must reflect the recipe actually being rendered when alt_description is absent.
  private buildRecipeImage(candidate: UnsplashCandidate, query: string, title: string): RecipeImage {
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
    };
  }

  // Ciclo B (design.md 12.5.2 paso 3, plan.md 12.1.3.b): public, invoked AFTER the recipe row
  // already exists, independently of search+selection. Takes the full persisted image (so it has
  // `tracking.trackingUrl`/`providerPhotoId` to work with) and returns a COPY with `tracking`
  // updated to SUCCEEDED/FAILED + `lastAttemptAt` - never mutates the argument, so a caller that
  // already persisted the PENDING version can safely diff before/after. Re-reads the API key
  // itself (D4): the key may have changed between search time and this later call. Same
  // single-attempt timeout/error-swallowing contract as the old private tracking call it
  // replaces, plus host revalidation (design.md 12.3): a persisted trackingUrl is just data, not
  // a trusted value, so it's checked again right before the fetch, not only at selection time.
  async trackDownload(persisted: PersistedRecipeImage): Promise<PersistedRecipeImage> {
    const { trackingUrl } = persisted.tracking;
    const fail = (): PersistedRecipeImage => ({
      ...persisted,
      tracking: { ...persisted.tracking, status: 'FAILED', lastAttemptAt: new Date().toISOString() },
    });

    if (!isValidUnsplashUrl(trackingUrl, UNSPLASH_API_HOST)) {
      this.logger.error(
        `Unsplash download_location tracking skipped for providerPhotoId=${persisted.providerPhotoId}: trackingUrl failed host validation`,
      );
      return fail();
    }

    const apiKey = this.configService.get<string>('UNSPLASH_ACCESS_KEY');
    if (!apiKey) {
      this.logger.warn(
        `Unsplash download_location tracking skipped: UNSPLASH_ACCESS_KEY is missing or empty (providerPhotoId=${persisted.providerPhotoId})`,
      );
      return fail();
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), UNSPLASH_TIMEOUT_MS);

    try {
      const response = await fetch(trackingUrl, {
        headers: { Authorization: `Client-ID ${apiKey}` },
        signal: abortController.signal,
      });

      // fetch() only rejects on transport failure, not on an error status (bug fix, design.md
      // 11.2) - a resolved-but-failed tracking call must still be logged as error and FAILED.
      if (!response.ok) {
        this.logger.error(
          `Unsplash download_location tracking failed for providerPhotoId=${persisted.providerPhotoId} url=${trackingUrl}: received status ${response.status}`,
        );
        return fail();
      }

      return {
        ...persisted,
        tracking: { ...persisted.tracking, status: 'SUCCEEDED', lastAttemptAt: new Date().toISOString() },
      };
    } catch (error: any) {
      this.logger.error(
        `Unsplash download_location tracking failed for providerPhotoId=${persisted.providerPhotoId} url=${trackingUrl}: ${error?.message ?? 'unknown error'}`,
      );
      return fail();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Ciclo B batch (design.md 12.5.2 paso 1, gap real NUT-83): same search+select+memoization
  // mechanics as attachImages below, but stops there - no trackDownload call, ever. Each
  // resolved recipe gets a full PersistedRecipeImage with tracking already PENDING, so the
  // caller (PlansService) can persist it as plain data and run the tracking fetch itself, after
  // the transaction commits (D2).
  async searchAndSelectImages(days: MealPlanDayDto[]): Promise<any[]> {
    const titleByQuery = new Map<string, string>();
    for (const day of days) {
      for (const meal of day.meals) {
        if (meal.recipe) {
          const normalizedQuery = buildUnsplashQuery(meal.recipe.title);
          if (!titleByQuery.has(normalizedQuery)) {
            titleByQuery.set(normalizedQuery, meal.recipe.title);
          }
        }
      }
    }

    const uniqueQueries = Array.from(titleByQuery.keys());
    const rawList = await resolveWithBoundedConcurrency(uniqueQueries, (normalizedQuery) =>
      this.searchAndSelectCandidateRaw(titleByQuery.get(normalizedQuery) as string),
    );

    const rawByQuery = new Map<string, { query: string; candidate: UnsplashCandidate } | null>();
    uniqueQueries.forEach((normalizedQuery, index) => {
      rawByQuery.set(normalizedQuery, rawList[index] ?? null);
    });

    return days.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => {
        if (!meal.recipe) {
          return meal;
        }
        const resolved = rawByQuery.get(buildUnsplashQuery(meal.recipe.title));
        return {
          ...meal,
          recipe: {
            ...meal.recipe,
            image: resolved
              ? {
                  ...this.buildRecipeImage(resolved.candidate, resolved.query, meal.recipe.title),
                  tracking: {
                    status: 'PENDING' as const,
                    lastAttemptAt: null,
                    trackingUrl: resolved.candidate.links.download_location,
                  },
                }
              : null,
          },
        };
      }),
    }));
  }

  // Batch orchestrator (same role as PexelsService.attachImages): resolves every new recipe's
  // image regardless of origin (D1 corrected), bounded concurrency (D3), deduplicated by
  // normalized query rather than raw title so two titles that normalize the same share one real
  // search call. Tracking is deduplicated the same way (one download_location call per unique
  // candidate, design.md 11.2), reusing the new public trackDownload - this orchestrator predates
  // the ciclo B post-persistence split and still resolves+tracks eagerly in one pass; its own
  // tests fix that contract, so it's preserved as-is rather than folded into the PENDING-only
  // searchAndSelectCandidate path used by the plan-persistence flow.
  async attachImages(days: MealPlanDayDto[]): Promise<any[]> {
    const titleByQuery = new Map<string, string>();
    for (const day of days) {
      for (const meal of day.meals) {
        if (meal.recipe) {
          const normalizedQuery = buildUnsplashQuery(meal.recipe.title);
          if (!titleByQuery.has(normalizedQuery)) {
            titleByQuery.set(normalizedQuery, meal.recipe.title);
          }
        }
      }
    }

    const uniqueQueries = Array.from(titleByQuery.keys());
    const rawList = await resolveWithBoundedConcurrency(uniqueQueries, (normalizedQuery) =>
      this.searchAndSelectCandidateRaw(titleByQuery.get(normalizedQuery) as string),
    );

    // Cached by query: only the candidate, never a finished `alt` (bug fix, design.md 11.2) -
    // `alt`'s fallback is computed below, per recipe, from its own title.
    const rawByQuery = new Map<string, { query: string; candidate: UnsplashCandidate } | null>();
    uniqueQueries.forEach((normalizedQuery, index) => {
      rawByQuery.set(normalizedQuery, rawList[index] ?? null);
    });

    // One download_location call per unique candidate, shared by every recipe resolving to the
    // same normalized query - never one per recipe.
    await resolveWithBoundedConcurrency(uniqueQueries, async (normalizedQuery) => {
      const raw = rawByQuery.get(normalizedQuery);
      if (!raw) {
        return;
      }
      const trackingOnly: PersistedRecipeImage = {
        provider: 'UNSPLASH',
        providerPhotoId: raw.candidate.id,
        imageUrl: '',
        sourceUrl: '',
        photographer: '',
        photographerUrl: '',
        alt: '',
        query: raw.query,
        retrievedAt: new Date().toISOString(),
        tracking: { status: 'PENDING', lastAttemptAt: null, trackingUrl: raw.candidate.links.download_location },
      };
      await this.trackDownload(trackingOnly);
    });

    return days.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => {
        if (!meal.recipe) {
          return meal;
        }
        const resolved = rawByQuery.get(buildUnsplashQuery(meal.recipe.title));
        return {
          ...meal,
          recipe: {
            ...meal.recipe,
            image: resolved ? this.buildRecipeImage(resolved.candidate, resolved.query, meal.recipe.title) : null,
          },
        };
      }),
    }));
  }
}
