// Arma la query a partir del título: sin acentos, en minúsculas, con espacios simples y el sufijo
// fijo "food recipe". Ej.: "  Ñoquis de Papá " -> "noquis de papa food recipe".
export function buildUnsplashQuery(title: string): string {
  const normalized = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  return `${normalized} food recipe`.trim();
}
