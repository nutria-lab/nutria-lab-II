// Deterministic query builder (design.md section 2). NFKD + strip combining diacritics mirrors
// the DB-level `unaccent` convention already used elsewhere in this domain, applied here at the
// application layer since there's no DB involved in building an external API query.
export function buildUnsplashQuery(title: string): string {
  const normalized = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  return `${normalized} food recipe`.trim();
}
