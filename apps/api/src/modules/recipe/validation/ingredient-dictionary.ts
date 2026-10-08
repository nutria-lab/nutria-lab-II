import { normalizeRecipeText } from '../recipe-fingerprint.util';

// Diccionario explícito de ingredientes (NUT-74): nada se infiere, todo está listado acá.
// Restricciones del perfil (nuts, dairy, gluten, shellfish, soy) y grupos que usa la regla de
// preferencias contradictorias (meat, fish, egg, honey).
export type IngredientGroup = 'nuts' | 'dairy' | 'gluten' | 'shellfish' | 'soy' | 'meat' | 'fish' | 'egg' | 'honey';

// Palabras (sin acentos; el plural regular se agrega solo) que delatan cada grupo, en español y en inglés.
const GROUP_KEYWORDS: Record<IngredientGroup, string[]> = {
  nuts: [
    'nuts', 'nut', 'nuez', 'nueces', 'almendra', 'avellana', 'mani', 'manies', 'cacahuate', 'cacahuete',
    'pistacho', 'castana', 'anacardo', 'pecana', 'macadamia', 'praline', 'frutos secos', 'turron', 'mazapan', 'pinon',
    'nutella', 'almond', 'hazelnut', 'peanut', 'walnut', 'pistachio', 'cashew', 'pecan',
  ],
  dairy: [
    'dairy', 'leche', 'queso', 'manteca', 'mantequilla', 'crema', 'yogur', 'yogurt', 'ricota', 'ricotta',
    'mozzarella', 'parmesano', 'cheddar', 'provolone', 'requeson', 'nata', 'kefir', 'helado', 'flan', 'ghee',
    'suero', 'lacteo', 'lactosa', 'milk', 'cheese', 'butter', 'cream',
  ],
  gluten: [
    'gluten', 'trigo', 'harina', 'pan', 'fideo', 'fideos', 'pasta', 'cebada', 'centeno', 'avena', 'semola',
    'seitan', 'cuscus', 'panqueque', 'galleta', 'galletita', 'tostada', 'empanada', 'pizza', 'tarta', 'torta',
    'bizcocho', 'bizcochuelo', 'medialuna', 'croissant', 'milanesa', 'rebozado', 'apanado', 'noquis', 'ravioles',
    'lasana', 'espagueti', 'spaghetti', 'cerveza', 'wheat', 'flour', 'bread', 'barley', 'rye', 'oat', 'oatmeal',
    'bulgur', 'espelta', 'malta', 'salvado', 'couscous', 'pancake',
  ],
  shellfish: [
    'shellfish', 'marisco', 'crustaceo', 'molusco', 'camaron', 'camarones', 'langostino', 'gamba', 'cangrejo',
    'langosta', 'centolla', 'berberecho', 'mejillon', 'mejillones',
    'almeja', 'calamar', 'calamares', 'pulpo', 'vieira', 'ostra', 'shrimp', 'prawn', 'crab', 'lobster', 'mussel',
    'clam', 'squid', 'octopus', 'scallop', 'oyster',
  ],
  soy: ['soy', 'soja', 'soya', 'tofu', 'tempeh', 'miso', 'edamame', 'shoyu'],
  meat: [
    'carne', 'pollo', 'cerdo', 'ternera', 'vacuno', 'cordero', 'jamon', 'panceta', 'tocino', 'chorizo',
    'salchicha', 'morcilla', 'pavo', 'pato', 'conejo', 'bife', 'chuleta', 'bondiola', 'matambre', 'hamburguesa',
    'meat', 'beef', 'chicken', 'pork', 'ham', 'bacon', 'turkey', 'lamb', 'sausage',
  ],
  fish: [
    'pescado', 'atun', 'salmon', 'merluza', 'bacalao', 'sardina', 'anchoa', 'trucha', 'caballa', 'boqueron',
    'lenguado', 'corvina', 'surimi', 'fish', 'tuna', 'cod', 'anchovy', 'anchovies', 'sardine', 'trout',
  ],
  egg: ['huevo', 'yema', 'mayonesa', 'merengue', 'egg', 'mayonnaise'],
  honey: ['miel', 'honey'],
};

// Frases que contienen una palabra de la lista pero NO son ese grupo: se borran antes de buscar.
// Ej.: "leche de almendras" no es lácteo (pero sigue siendo NUTS por "almendras").
const PLANT_BASES = 'almendras?|coco|soja|soya|avena|arroz|mani|castanas?|anacardos?|avellanas?|nueces|vegetal(es)?|vegan[ao]s?';
const GLUTEN_FREE_BASES = 'arroz|maiz|almendras?|coco|garbanzos?|mandioca|quinoa|trigo sarraceno';
const PLANT_PROTEINS = 'soja|soya|lentejas?|garbanzos?|quinoa|porotos?|vegetal(es)?|vegan[ao]s?';
const GROUP_EXCEPTIONS: Record<IngredientGroup, RegExp[]> = {
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
  meat: [
    new RegExp(`\\b(carne|hamburguesa)s?\\s+(de\\s+)?(${PLANT_PROTEINS})\\b`, 'g'),
    /\b(sin|libre de)\s+carne\b/g,
  ],
  fish: [],
  egg: [/\b(sin|libre de)\s+huevos?\b/g],
  honey: [/\bmiel\s+de\s+(agave|maple|arce|cana|maiz)\b/g],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Palabra completa, con plural opcional (nuez -> nueces se lista aparte; almendra -> almendras).
// Antes de buscar se borran las excepciones del grupo y las negaciones explícitas de cada palabra
// ("sin maní", "libre de mariscos"); sólo esa mención: "sin queso, con crema" sigue siendo DAIRY.
function mentionsGroup(text: string, group: string): boolean {
  // Un grupo desconocido se busca por su propio nombre.
  const keywords = (GROUP_KEYWORDS[group as IngredientGroup] ?? [normalizeRecipeText(group)]).map(escapeRegExp);
  const exceptions = GROUP_EXCEPTIONS[group as IngredientGroup] ?? [];
  const negations = keywords.map(keyword => new RegExp(`\\b(sin|libre de)\\s+${keyword}(s|es)?\\b`, 'g'));
  const cleaned = [...exceptions, ...negations].reduce((current, pattern) => current.replace(pattern, ' '), text);
  return keywords.some(keyword => new RegExp(`\\b${keyword}(s|es)?\\b`).test(cleaned));
}

// Devuelve el primer grupo (en el orden recibido) que aparece en alguno de los textos, o null.
export function findIngredientGroup(texts: readonly string[], groups: readonly string[]): string | null {
  const text = normalizeRecipeText(texts.join(' | '));
  return groups.find(group => mentionsGroup(text, group)) ?? null;
}

// Restricciones excluidas del perfil, en minúsculas (ej.: ['gluten', 'nuts']).
export function forbiddenRestrictions(profile: { excludedIngredients?: unknown }): string[] {
  const excluded = Array.isArray(profile.excludedIngredients) ? profile.excludedIngredients : [];
  return excluded.map(String).map(restriction => restriction.toLowerCase());
}

/**
 * The profile policy used by generated recipes.  Diet labels on a catalog or
 * model response are intentionally not trusted: callers pass these groups to
 * the same text/ingredient validation used for explicit exclusions.
 */
export function profileForbiddenRestrictions(profile: { diet?: unknown; excludedIngredients?: unknown }): string[] {
  const restrictions = new Set(forbiddenRestrictions(profile));
  switch (profile.diet) {
    case 'VEGAN':
      ['meat', 'fish', 'shellfish', 'dairy', 'egg', 'honey'].forEach(group => restrictions.add(group));
      break;
    case 'VEGETARIAN':
      ['meat', 'fish', 'shellfish'].forEach(group => restrictions.add(group));
      break;
    case 'PESCATARIAN':
      restrictions.add('meat');
      break;
  }
  return [...restrictions];
}

/** KETO and PALEO have no approved deterministic ingredient policy yet. */
export function hasSupportedProfilePolicy(profile: { diet?: unknown } | null | undefined): boolean {
  return !!profile && profile.diet !== 'KETO' && profile.diet !== 'PALEO';
}

// Textos de una comida o receta que se revisan contra las restricciones: único lugar donde se decide
// (validador, plan manual/editado y filtros del catálogo). Incluye los pasos.
export interface RestrictionTextSource {
  mealTitle?: unknown;
  title?: unknown;
  description?: unknown;
  nutritionDescription?: unknown;
  ingredients?: unknown;
  instructions?: unknown;
}

export function restrictionTexts(source: RestrictionTextSource): string[] {
  const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
  const ingredients = Array.isArray(source.ingredients) ? source.ingredients : [];
  const names = ingredients.map(ingredient =>
    typeof ingredient === 'object' && ingredient !== null ? (ingredient as { name?: unknown }).name : undefined);
  const steps = Array.isArray(source.instructions) ? source.instructions : [source.instructions];
  return [source.mealTitle, source.title, source.description, source.nutritionDescription, ...names, ...steps].filter(isText);
}

// Primera restricción del perfil (en cualquier capitalización) que aparece en los textos, en minúsculas.
export function findExcludedIngredient(texts: readonly string[], excluded: readonly string[]): string | null {
  return findIngredientGroup(texts, excluded.map(restriction => restriction.toLowerCase()));
}
