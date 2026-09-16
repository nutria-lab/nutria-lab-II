import { Transform } from 'class-transformer';

/**
 * Normaliza un array de propiedades/etiquetas de texto libre según las reglas del dominio:
 * 1. Trim de espacios al inicio y final.
 * 2. Colapsar espacios consecutivos intermedios a uno solo.
 * 3. Descartar cadenas vacías o compuestas sólo de espacios.
 * 4. Deduplicar case-insensitive preservando el valor y casing de la primera aparición.
 */
export function normalizeProperties(properties: string[]): string[] {
  if (!Array.isArray(properties)) {
    return [];
  }

  const normalized = properties
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().replace(/\s+/g, ' '))
    .filter(item => item.length > 0);

  const unique: string[] = [];
  const seen = new Set<string>();

  for (const item of normalized) {
    const lower = item.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      unique.push(item);
    }
  }

  return unique;
}

/**
 * Decorador para DTOs que delega la sanitización y normalización de `properties`
 * a la función utilitaria `normalizeProperties`.
 * Si el valor no es un array (por ejemplo undefined o tipo inválido), preserva el valor original
 * para que @IsOptional() o @IsArray() manejen la validación correctamente.
 */
export function NormalizeProperties() {
  return Transform(({ value }) => {
    if (!Array.isArray(value)) {
      return value;
    }
    return normalizeProperties(value);
  });
}
