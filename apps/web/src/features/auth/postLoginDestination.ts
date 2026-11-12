export const DEFAULT_POST_LOGIN_PATH = '/dashboard';

// Origen ficticio solo para resolver el path: si al resolverlo cambia de origen, no era un path propio.
const PARSE_ORIGIN = 'http://nutria.invalid';
const PUBLIC_AUTH_PATHS = new Set(['/login', '/register']);
// Controles C0, espacio, DEL y la barra invertida: los navegadores los descartan o los
// normalizan a "/", lo que puede convertir "/\evil.test" en "//evil.test".
const UNSAFE_CHARACTERS = /[\u0000- \u007F\\]/;

function textOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Convierte el destino solicitado (el `from` que ProtectedApp guarda en el state del router)
 * en un path propio de la app. Cualquier otro valor vuelve al dashboard.
 */
export function resolvePostLoginDestination(from: unknown): string {
  if (!from || typeof from !== 'object') return DEFAULT_POST_LOGIN_PATH;

  const location = from as { pathname?: unknown; search?: unknown; hash?: unknown };
  const candidate = `${textOrEmpty(location.pathname)}${textOrEmpty(location.search)}${textOrEmpty(location.hash)}`;

  if (!candidate.startsWith('/') || candidate.startsWith('//') || UNSAFE_CHARACTERS.test(candidate)) {
    return DEFAULT_POST_LOGIN_PATH;
  }

  let url: URL;
  try {
    url = new URL(candidate, PARSE_ORIGIN);
  } catch {
    return DEFAULT_POST_LOGIN_PATH;
  }

  if (url.origin !== PARSE_ORIGIN || PUBLIC_AUTH_PATHS.has(url.pathname)) {
    return DEFAULT_POST_LOGIN_PATH;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
