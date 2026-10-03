/**
 * Construye la query determinística usada para buscar una foto de comida en Pexels,
 * a partir del título de una receta (design.md sección 2).
 *
 * Transformaciones, en este orden exacto:
 * 1. Normalización Unicode NFKD.
 * 2. Eliminar las marcas diacríticas combinantes (rango Unicode ̀-ͯ), dejando sólo
 *    las letras base en ASCII.
 * 3. Trim de espacios al inicio y al final.
 * 4. Colapsar cualquier secuencia de espacios en blanco internos (incluyendo
 *    tabs/saltos de línea) a un único espacio ASCII.
 * 5. Lowercase (sin locale especial).
 * 6. Concatenar con el sufijo fijo literal " food recipe".
 *
 * Función pura, sin estado ni reloj: llamarla dos veces con el mismo input produce
 * exactamente el mismo output.
 */
export function buildPexelsQuery(title: string): string {
  const normalized = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  return `${normalized} food recipe`.trim();
}
