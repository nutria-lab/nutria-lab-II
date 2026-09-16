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
