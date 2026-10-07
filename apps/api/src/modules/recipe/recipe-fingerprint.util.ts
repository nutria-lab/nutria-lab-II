// Huella de una receta (NUT-72), compartida con la detección de duplicados de NUT-74.

// PostgreSQL's unaccent expands common ligatures as well as stripping combining marks.
// Keep the small explicit expansion set here so the defensive in-memory ordering does
// not undo the repository's SQL order before applying the requested limit.
export function normalizeRecipeText(value: string): string {
  return value
    .replace(/[ÆæŒœßŁłØøĐđÞþ]/g, character => ({
      Æ: 'AE', æ: 'ae', Œ: 'OE', œ: 'oe', ß: 'ss',
      Ł: 'L', ł: 'l', Ø: 'O', ø: 'o', Đ: 'D', đ: 'd', Þ: 'TH', þ: 'th',
    })[character] ?? character)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Minúsculas, sin acentos ni signos y con los espacios colapsados: "  Ensalada CÉSAR! " → "ensalada cesar".
export function normalizeRecipeTitle(value: string): string {
  return normalizeRecipeText(value)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Título normalizado + nombres de ingredientes normalizados, sin repetir y ordenados.
export function recipeFingerprint(recipe: { title: string; ingredients: unknown }): string {
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const names = ingredients
    .map(ingredient => typeof ingredient === 'object' && ingredient !== null && 'name' in ingredient && typeof ingredient.name === 'string'
      ? normalizeRecipeTitle(ingredient.name) : '')
    .filter(Boolean);
  return [normalizeRecipeTitle(recipe.title), ...[...new Set(names)].sort()].join('|');
}
