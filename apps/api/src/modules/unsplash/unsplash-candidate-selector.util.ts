import { isValidUnsplashUrl, UNSPLASH_API_HOST, UNSPLASH_IMAGE_HOST, UNSPLASH_PAGE_HOST } from './unsplash-url-validator.util';

export type UnsplashCandidate = {
  id: string; // Unsplash devuelve ids string (ej.: "LBI7cgq3pbM"), nunca números.
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

// Un candidato sirve si trae todos los campos que guardamos, dimensiones positivas y URLs HTTPS
// de los hosts de Unsplash. alt_description es opcional: si falta se usa un texto de respaldo.
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

  // Cada URL tiene que ser HTTPS y del host esperado para ese campo.
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

// Devuelve el primer candidato válido respetando el orden de relevancia de Unsplash.
// Si un id aparece repetido en la respuesta, sólo cuenta la primera vez.
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
