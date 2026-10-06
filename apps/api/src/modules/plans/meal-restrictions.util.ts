// Lo mínimo de una comida que hace falta para revisar restricciones.
export interface RestrictionCheckMeal {
  title: string;
  nutritionalValues?: { Description?: string } | null;
  recipe?: { ingredients?: Array<{ name: string }> } | null;
}

// Palabras (sin acentos, en singular) que delatan cada restricción, en español y en inglés.
const RESTRICTION_KEYWORDS: Record<string, string[]> = {
  nuts: [
    'nuts', 'nut', 'nuez', 'nueces', 'almendra', 'avellana', 'mani', 'manies', 'cacahuate', 'cacahuete',
    'pistacho', 'castana', 'anacardo', 'pecana', 'macadamia', 'praline', 'frutos secos', 'turron', 'mazapan',
    'nutella', 'almond', 'hazelnut', 'peanut', 'walnut', 'pistachio', 'cashew', 'pecan',
  ],
  dairy: [
    'dairy', 'leche', 'queso', 'manteca', 'mantequilla', 'crema', 'yogur', 'yogurt', 'ricota', 'ricotta',
    'mozzarella', 'parmesano', 'cheddar', 'provolone', 'requeson', 'nata', 'kefir', 'helado', 'flan', 'ghee',
    'suero', 'milk', 'cheese', 'butter', 'cream',
  ],
  gluten: [
    'gluten', 'trigo', 'harina', 'pan', 'fideo', 'fideos', 'pasta', 'cebada', 'centeno', 'avena', 'semola',
    'seitan', 'cuscus', 'panqueque', 'galleta', 'galletita', 'tostada', 'empanada', 'pizza', 'tarta', 'torta',
    'bizcocho', 'bizcochuelo', 'medialuna', 'croissant', 'milanesa', 'rebozado', 'apanado', 'noquis', 'ravioles',
    'lasana', 'espagueti', 'spaghetti', 'cerveza', 'wheat', 'flour', 'bread', 'barley', 'rye', 'oat', 'oatmeal',
    'couscous', 'pancake',
  ],
  shellfish: [
    'shellfish', 'marisco', 'crustaceo', 'molusco', 'camaron', 'camarones', 'langostino', 'gamba', 'cangrejo',
    'langosta', 'centolla', 'berberecho', 'mejillon', 'mejillones',
    'almeja', 'calamar', 'calamares', 'pulpo', 'vieira', 'ostra', 'shrimp', 'prawn', 'crab', 'lobster', 'mussel',
    'clam', 'squid', 'octopus', 'scallop', 'oyster',
  ],
  soy: ['soy', 'soja', 'soya', 'tofu', 'tempeh', 'miso', 'edamame'],
};

// Frases que contienen una palabra de la lista pero NO son ese alérgeno: se borran antes de buscar.
// Ej.: "leche de almendras" no es lácteo (pero sigue siendo NUTS por "almendras").
const PLANT_BASES = 'almendras?|coco|soja|soya|avena|arroz|mani|castanas?|anacardos?|avellanas?|nueces|vegetal(es)?|vegan[ao]s?';
const GLUTEN_FREE_BASES = 'arroz|maiz|almendras?|coco|garbanzos?|mandioca|quinoa|trigo sarraceno';
const RESTRICTION_EXCEPTIONS: Record<string, RegExp[]> = {
  dairy: [
    new RegExp(`\\b(leche|crema|yogur|yogurt|queso|manteca|mantequilla)s?\\s+(de\\s+)?(${PLANT_BASES})\\b`, 'g'),
    /\b(sin|libre de)\s+(lacteos?|lactosa|leche)\b/g,
  ],
  gluten: [
    new RegExp(`\\b(harina|pan|fideos?|pasta)s?\\s+de\\s+(${GLUTEN_FREE_BASES})\\b`, 'g'),
    /\bpasta\s+de\s+(mani|sesamo|tomate|ajo|curry|miso)\b/g,
    /\b(\w+\s+)?(sin|libre de)\s+gluten\b/g,
    /\bgluten[\s-]free\b/g,
  ],
  nuts: [/\bnuez\s+moscada\b/g, /\b(sin|libre de)\s+frutos secos\b/g],
  soy: [/\b(sin|libre de)\s+soja\b/g],
  shellfish: [],
};

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Restricciones excluidas del perfil, en minúsculas (ej.: ['gluten', 'nuts']).
export function forbiddenRestrictions(profile: { excludedIngredients?: unknown }): string[] {
  const excluded = Array.isArray(profile.excludedIngredients) ? profile.excludedIngredients : [];
  return excluded.map(String).map(restriction => restriction.toLowerCase());
}

// Devuelve la primera restricción que aparece en el título, la descripción o los ingredientes de
// la comida, o null si no viola ninguna. La usan el plan semanal y el reemplazo de una comida.
export function findRestrictionViolation(meal: RestrictionCheckMeal, forbidden: string[]): string | null {
  const ingredientNames = meal.recipe?.ingredients?.map(ingredient => ingredient.name) || [];
  const text = normalize([meal.title, meal.nutritionalValues?.Description || '', ...ingredientNames].join(' | '));

  for (const restriction of forbidden) {
    const exceptions = RESTRICTION_EXCEPTIONS[restriction] ?? [];
    const cleaned = exceptions.reduce((current, exception) => current.replace(exception, ' '), text);
    // Una restricción desconocida se busca por su propio nombre, como antes.
    const keywords = RESTRICTION_KEYWORDS[restriction] ?? [normalize(restriction)];

    // Palabra completa, con plural opcional (nuez -> nueces se lista aparte; almendra -> almendras).
    if (keywords.some(keyword => new RegExp(`\\b${keyword}(s|es)?\\b`).test(cleaned))) {
      return restriction;
    }
  }
  return null;
}
