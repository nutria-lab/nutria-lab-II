// true sólo si la URL es HTTPS y su host es exactamente expectedHost. Se parsea con URL (no se
// buscan substrings) para que https://api.unsplash.com@evil.com o subdominios parecidos no pasen.
export function isValidUnsplashUrl(value: unknown, expectedHost: string): boolean {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return parsed.protocol === 'https:' && parsed.hostname === expectedHost;
}

// Host esperado para cada tipo de URL que devuelve Unsplash.
export const UNSPLASH_IMAGE_HOST = 'images.unsplash.com';
export const UNSPLASH_PAGE_HOST = 'unsplash.com';
export const UNSPLASH_API_HOST = 'api.unsplash.com';
