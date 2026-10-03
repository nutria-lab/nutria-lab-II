// Candidate validity predicate + selection (design.md section 3, field names per Unsplash
// contract - plan.md 11.2). `alt_description` is intentionally not required here: its
// absence is handled by the service's alt-fallback, not by candidate validity.
import { isValidUnsplashUrl, UNSPLASH_API_HOST, UNSPLASH_IMAGE_HOST, UNSPLASH_PAGE_HOST } from './unsplash-url-validator.util';

export type UnsplashCandidate = {
  id: string; // Unsplash returns string ids (e.g. "LBI7cgq3pbM"), never numbers (design.md 12.1/12.2 fix #1).
  urls: { regular: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
  alt_description?: string | null;
  width: number;
  height: number;
  [key: string]: unknown;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isValidCandidate(candidate: unknown): candidate is UnsplashCandidate {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }

  const record = candidate as Record<string, unknown>;

  if (typeof record.id !== 'string' || record.id.length === 0) {
    return false;
  }

  const urls = record.urls as Record<string, unknown> | undefined;
  if (typeof urls !== 'object' || urls === null || !isNonEmptyString(urls.regular)) {
    return false;
  }

  const links = record.links as Record<string, unknown> | undefined;
  if (
    typeof links !== 'object' ||
    links === null ||
    !isNonEmptyString(links.html) ||
    !isNonEmptyString(links.download_location)
  ) {
    return false;
  }

  const user = record.user as Record<string, unknown> | undefined;
  if (typeof user !== 'object' || user === null || !isNonEmptyString(user.name)) {
    return false;
  }

  const userLinks = user.links as Record<string, unknown> | undefined;
  if (typeof userLinks !== 'object' || userLinks === null || !isNonEmptyString(userLinks.html)) {
    return false;
  }

  if (!isPositiveInteger(record.width) || !isPositiveInteger(record.height)) {
    return false;
  }

  if (
    !isValidUnsplashUrl(urls.regular, UNSPLASH_IMAGE_HOST) ||
    !isValidUnsplashUrl(links.html, UNSPLASH_PAGE_HOST) ||
    !isValidUnsplashUrl(userLinks.html, UNSPLASH_PAGE_HOST) ||
    !isValidUnsplashUrl(links.download_location, UNSPLASH_API_HOST)
  ) {
    return false;
  }

  return true;
}

// Duplicate ids in the same response collapse to the first occurrence by position (design.md
// section 3, tie-break interpretation) before the "first valid by position" rule applies.
export function selectUnsplashCandidate(results: unknown): UnsplashCandidate | null {
  if (!Array.isArray(results)) {
    return null;
  }

  const seenIds = new Set<string>();

  for (const candidate of results) {
    if (typeof candidate === 'object' && candidate !== null && typeof (candidate as Record<string, unknown>).id === 'string') {
      const id = (candidate as Record<string, unknown>).id as string;
      if (seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);
    }

    if (isValidCandidate(candidate)) {
      return candidate;
    }
  }

  return null;
}
