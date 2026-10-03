/**
 * Forma mínima de un candidato de foto de Pexels ya validado (design.md sección 3).
 */
export type PexelsCandidate = {
  id: number;
  src: { large: string };
  url: string;
  photographer: string;
  photographer_url: string;
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

function isValidCandidate(candidate: unknown): candidate is PexelsCandidate {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }

  const record = candidate as Record<string, unknown>;

  if (typeof record.id !== 'number' || !Number.isFinite(record.id)) {
    return false;
  }

  const src = record.src as Record<string, unknown> | undefined;
  if (typeof src !== 'object' || src === null || !isNonEmptyString(src.large)) {
    return false;
  }

  if (!isNonEmptyString(record.url)) {
    return false;
  }

  if (!isNonEmptyString(record.photographer)) {
    return false;
  }

  if (!isNonEmptyString(record.photographer_url)) {
    return false;
  }

  if (!isPositiveInteger(record.width) || !isPositiveInteger(record.height)) {
    return false;
  }

  return true;
}

/**
 * Selecciona el primer candidato válido de una respuesta de Pexels (ya parseada),
 * siguiendo design.md sección 3: recorre `photos` en el orden de la respuesta y
 * devuelve el primer elemento que cumple el predicado completo de validez.
 *
 * Si `photos` no es un array, devuelve `null`. Si un `id` ya fue visto en una
 * posición anterior, ese candidato duplicado no vuelve a considerarse (el primero
 * por posición con ese id ya decidió el resultado). Nunca lanza.
 */
export function selectPexelsCandidate(photos: unknown): PexelsCandidate | null {
  if (!Array.isArray(photos)) {
    return null;
  }

  const seenIds = new Set<number>();

  for (const candidate of photos) {
    if (typeof candidate === 'object' && candidate !== null && typeof (candidate as Record<string, unknown>).id === 'number') {
      const id = (candidate as Record<string, unknown>).id as number;
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
