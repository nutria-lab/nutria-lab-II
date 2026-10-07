import { normalizeRecipeTitle, recipeFingerprint } from '../recipe/recipe-fingerprint.util';

// Comida tal como se compara: su tipo, su título y (si tiene) la receta con título e ingredientes.
interface ComparableMeal {
  mealType: string;
  title: string;
  recipe?: { title: string; ingredients: unknown } | null;
}

interface ComparableDay {
  day: string;
  meals: ComparableMeal[];
}

// Huellas por franja (día + tipo de comida). Con más de una comida del mismo tipo en el día, se
// comparan ordenadas: el orden dentro del día no cuenta como cambio.
function slotFingerprints(days: readonly ComparableDay[]): Map<string, string> {
  const slots = new Map<string, string[]>();
  for (const day of days) {
    for (const meal of day.meals) {
      const key = `${day.day}|${meal.mealType}`;
      // Huella de NUT-72; una comida sin receta se compara por su título normalizado.
      const fingerprint = meal.recipe ? recipeFingerprint(meal.recipe) : `title:${normalizeRecipeTitle(meal.title)}`;
      slots.set(key, [...(slots.get(key) ?? []), fingerprint]);
    }
  }
  return new Map([...slots].map(([key, fingerprints]) => [key, fingerprints.sort().join('||')]));
}

// NUT-78: la propuesta es "materialmente nueva" si al menos una franja cambió respecto de la versión
// anterior (otra receta, o una comida de más o de menos).
export function hasMaterialChange(previous: readonly ComparableDay[], proposed: readonly ComparableDay[]): boolean {
  const before = slotFingerprints(previous);
  const after = slotFingerprints(proposed);
  if (before.size !== after.size) return true;
  return [...after].some(([key, fingerprint]) => before.get(key) !== fingerprint);
}

// Genera hasta `maxAttempts` propuestas y devuelve la primera distinta, o null si ninguna lo es.
// Un error de la composición (proveedor o validación) corta sin reintentar.
export async function firstDifferentProposal<T>(
  compose: () => Promise<T>,
  isDifferent: (proposal: T) => boolean,
  maxAttempts = 2,
): Promise<T | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const proposal = await compose();
    if (isDifferent(proposal)) return proposal;
  }
  return null;
}
