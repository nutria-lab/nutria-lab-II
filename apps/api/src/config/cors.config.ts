import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

const LOCAL_WEB_ORIGIN = 'http://localhost:5173';

type Environment = {
  NODE_ENV?: string;
  CORS_ORIGINS?: string;
};

function normalizeOrigin(value: string, isProduction: boolean): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('CORS_ORIGINS debe contener orígenes absolutos válidos.');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('CORS_ORIGINS debe contener únicamente orígenes exactos.');
  }

  if (isProduction && url.protocol !== 'https:') {
    throw new Error('CORS_ORIGINS debe usar HTTPS en producción.');
  }

  return url.origin;
}

function getAllowedOrigins(environment: Environment): Set<string> {
  const isProduction = environment.NODE_ENV === 'production';
  const configuredOrigins = environment.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!configuredOrigins?.length) {
    if (isProduction) {
      throw new Error('CORS_ORIGINS es obligatorio en producción.');
    }

    return new Set([LOCAL_WEB_ORIGIN]);
  }

  return new Set(
    configuredOrigins.map((origin) => normalizeOrigin(origin, isProduction)),
  );
}

export function createCorsOptions(environment: Environment): CorsOptions {
  const allowedOrigins = getAllowedOrigins(environment);

  return {
    credentials: true,
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
  };
}
