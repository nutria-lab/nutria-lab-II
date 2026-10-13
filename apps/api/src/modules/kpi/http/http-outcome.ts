// NUT-85 — Clasificación HTTP, normalización de operación y exclusiones (design D6, D7, D8). Funciones puras.

export type HttpTerminalOutcome = 'success' | 'client_error' | 'server_error' | 'network_error' | 'timeout' | 'other';

export interface HttpOutcomeInput {
  statusCode: number | null;
  /** El socket se cerró antes de terminar la respuesta. */
  clientDisconnected?: boolean;
  /** El propio servidor señaló el timeout (timeout confirmado). */
  serverTimedOut?: boolean;
}

export interface HttpOutcomeResult {
  outcome: HttpTerminalOutcome;
  httpStatus: number | null;
}

/** Valor fijo del INSERT pending (antes del ruteo). */
export const UNRESOLVED_OPERATION = 'UNRESOLVED';
/** Valor fijo cuando ninguna ruta matcheó. */
export const UNMATCHED_OPERATION = 'UNMATCHED';

const MAX_OPERATION_LENGTH = 200;

export function classifyHttpOutcome(input: HttpOutcomeInput): HttpOutcomeResult {
  if (input.serverTimedOut) return { outcome: 'timeout', httpStatus: input.statusCode };
  if (input.clientDisconnected) return { outcome: 'network_error', httpStatus: null };

  const status = input.statusCode;
  if (status === null) return { outcome: 'other', httpStatus: null };
  if (status === 408 || status === 504) return { outcome: 'timeout', httpStatus: status };
  if (status >= 200 && status <= 299) return { outcome: 'success', httpStatus: status };
  if (status >= 400 && status <= 499) return { outcome: 'client_error', httpStatus: status };
  if (status >= 500 && status <= 599) return { outcome: 'server_error', httpStatus: status };
  return { outcome: 'other', httpStatus: status };
}

function pathOnly(url: string): string {
  const withoutQuery = url.split('?')[0].split('#')[0];
  const trimmed = withoutQuery.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** Método + plantilla de ruta (nunca la URL real), sin query ni barra final, ≤ 200 caracteres. */
export function normalizeOperation(method: string, routeTemplate: string | null | undefined): string {
  if (!routeTemplate) return UNMATCHED_OPERATION;
  return `${method.toUpperCase()} ${pathOnly(routeTemplate)}`.slice(0, MAX_OPERATION_LENGTH);
}

/** /health, el prefijo reservado /kpi (reporting) y las preflight OPTIONS no son tráfico de negocio. */
export function isExcludedFromTraffic(method: string, url: string): boolean {
  if (method.toUpperCase() === 'OPTIONS') return true;
  const path = pathOnly(url);
  return path === '/health' || path === '/kpi' || path.startsWith('/kpi/');
}
