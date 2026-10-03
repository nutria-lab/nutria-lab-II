// Single source of truth for "is this URL a trustworthy Unsplash URL for this field" (design.md
// 12.3), reused by candidate selection and any code that attaches the Authorization header to a
// provider URL. `URL` parsing (not substring matching) defeats the userinfo trick
// (https://host@evil.com/... parses to hostname=evil.com) and look-alike subdomains
// (host.evil.com !== host via strict ===).
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

// Hosts expected per candidate field (design.md 12.3) - exported so the consumers of
// isValidUnsplashUrl don't each repeat the hostname literal.
export const UNSPLASH_IMAGE_HOST = 'images.unsplash.com';
export const UNSPLASH_PAGE_HOST = 'unsplash.com';
export const UNSPLASH_API_HOST = 'api.unsplash.com';
