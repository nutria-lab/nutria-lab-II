import { IngredientType } from '../generated/prisma/client';

export const PECHUGA_POLLO_SEED = {
  name: 'Pechuga de Pollo',
  type: IngredientType.MEAT,
  description: 'Corte magro de pollo, ideal para dietas altas en proteínas.',
  defaultUnit: 'g',
  nutritionalValues: { calories: 165, protein: 31, carbs: 0, fat: 3.6, sodium: 74 },
  properties: ['Alto en Proteína', 'Bajo en Grasa']
};

export const ARROZ_INTEGRAL_SEED = {
  name: 'Arroz Integral',
  type: IngredientType.GRAIN,
  description: 'Grano entero rico en fibra.',
  defaultUnit: 'g',
  nutritionalValues: { calories: 111, protein: 2.6, carbs: 23, fat: 0.9, fiber: 1.8 },
  properties: ['Sin Gluten', 'Alto en Fibra']
};

export const RECETA_POLLO_ID = '11111111-1111-1111-1111-111111111111';

export const RECETA_POLLO_SEED = {
  title: 'Pollo con Arroz',
  description: 'Pechuga de pollo con arroz integral',
  prepMinutes: 10,
  cookMinutes: 20,
  categories: ['HIGH_PROTEIN', 'GLUTEN_FREE'] as any,
  ingredients: [
    { name: 'Pechuga de Pollo', quantity: 200, unit: 'g' },
    { name: 'Arroz Integral', quantity: 100, unit: 'g' },
  ],
  instructions: ['Cortar el pollo', 'Cocinar el pollo', 'Hervir el arroz'],
  nutritionalValues: { calories: 420, protein: 36, carbs: 45, fat: 8 },
  properties: ['Alto en Proteína', 'Sin Gluten']
};

export async function seedBaseData(client: any) {
  const pechuga = await client.ingredient.upsert({
    where: { name: PECHUGA_POLLO_SEED.name },
    update: {
      type: PECHUGA_POLLO_SEED.type,
      description: PECHUGA_POLLO_SEED.description,
      defaultUnit: PECHUGA_POLLO_SEED.defaultUnit,
      nutritionalValues: PECHUGA_POLLO_SEED.nutritionalValues,
      properties: PECHUGA_POLLO_SEED.properties,
    },
    create: PECHUGA_POLLO_SEED,
  });

  const arroz = await client.ingredient.upsert({
    where: { name: ARROZ_INTEGRAL_SEED.name },
    update: {
      type: ARROZ_INTEGRAL_SEED.type,
      description: ARROZ_INTEGRAL_SEED.description,
      defaultUnit: ARROZ_INTEGRAL_SEED.defaultUnit,
      nutritionalValues: ARROZ_INTEGRAL_SEED.nutritionalValues,
      properties: ARROZ_INTEGRAL_SEED.properties,
    },
    create: ARROZ_INTEGRAL_SEED,
  });

  const recipePollo = await client.recipe.upsert({
    where: { id: RECETA_POLLO_ID },
    update: RECETA_POLLO_SEED,
    create: {
      id: RECETA_POLLO_ID,
      ...RECETA_POLLO_SEED,
    },
  });

  return { pechuga, arroz, recipePollo };
}

// NUT-114 — Convenciones de identidad del seed sintético (solo constantes y funciones puras).
export const SYNTHETIC_EMAIL_DOMAIN = 'nutria.test';

const pad5 = (n: number) => String(n).padStart(5, '0');

export function syntheticEmail(n: number): string {
  return `demo.seed.${pad5(n)}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

export function syntheticName(n: number): string {
  return `Demo Sintético ${pad5(n)}`;
}

export const DEMO_WALKTHROUGH_EMAIL = 'demo.seed.00001@nutria.test';

export const SEED_TABLE_CODES = {
  users: '0001',
  recipes: '0002',
  mealPlans: '0003',
  days: '0004',
  meals: '0005',
  profiles: '0006',
  ingredients: '0007',
  completions: '0008',
  shoppingChecks: '0009',
} as const;

export type SeedTable = keyof typeof SEED_TABLE_CODES;

const MAX_SYNTH_INDEX = 999_999_999_999;

// '5eed' + código de tabla + '-0000-4000-8000-' + n con 12 dígitos (UUID v4 válido y reconocible).
export function synthId(table: SeedTable, n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > MAX_SYNTH_INDEX) {
    throw new RangeError('synthId index must be an integer in [0, 999999999999]');
  }
  return `5eed${SEED_TABLE_CODES[table]}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}
