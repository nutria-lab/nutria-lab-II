import { createHash } from 'crypto';

/**
 * Serializa un valor a JSON de forma determinística: las claves de todo objeto
 * (incluyendo objetos anidados) se ordenan alfabéticamente antes de serializar,
 * de modo que dos objetos con las mismas claves/valores pero distinto orden de
 * inserción produzcan exactamente la misma cadena. Los arrays conservan su orden
 * (el orden de un array es significativo, no se reordena).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => sortKeysDeep(item));
  }

  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const sortedEntries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map(key => [key, sortKeysDeep((value as Record<string, unknown>)[key])] as const);

    return sortedEntries.reduce<Record<string, unknown>>((acc, [key, sortedValue]) => {
      acc[key] = sortedValue;
      return acc;
    }, {});
  }

  return value;
}

/**
 * Calcula un hash de idempotencia determinístico (SHA-256, sin salt) a partir de
 * `{userId, kind, requestSnapshot}`, serializado con `canonicalJson`.
 *
 * Se usa SHA-256 en vez de bcrypt deliberadamente: bcrypt genera un salt aleatorio
 * en cada llamada, así que dos hashes del mismo contenido nunca serían iguales entre
 * sí, lo que rompería la búsqueda por igualdad que este campo necesita para deduplicar
 * (ver design.md sección 6, "Sobre idempotencyKeyHash: por qué SHA-256 y no bcrypt").
 * El contenido hasheado no es un secreto de baja entropía a proteger contra fuerza
 * bruta: el objetivo es únicamente un fingerprint estable para deduplicar solicitudes.
 */
export function computeIdempotencyKeyHash(input: {
  userId: string;
  kind: string;
  requestSnapshot: unknown;
}): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}
