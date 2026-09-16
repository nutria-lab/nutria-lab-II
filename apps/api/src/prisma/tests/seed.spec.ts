import {
  seedBaseData,
  PECHUGA_POLLO_SEED,
  ARROZ_INTEGRAL_SEED,
  RECETA_POLLO_SEED,
  RECETA_POLLO_ID,
} from '../seed-data';

describe('Seed Idempotency & Pre-existing Records Update', () => {
  it('updates pre-existing records with full metadata (description, defaultUnit, properties, fiber, sodium)', async () => {
    const existingDbState = {
      ingredients: {
        'Pechuga de Pollo': {
          id: 'ing-1',
          name: 'Pechuga de Pollo',
          type: 'MEAT',
          description: null,
          defaultUnit: null,
          properties: [],
          nutritionalValues: { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
        },
        'Arroz Integral': {
          id: 'ing-2',
          name: 'Arroz Integral',
          type: 'GRAIN',
          description: null,
          defaultUnit: null,
          properties: [],
          nutritionalValues: { calories: 111, protein: 2.6, carbs: 23, fat: 0.9 },
        },
      },
      recipes: {
        [RECETA_POLLO_ID]: {
          id: RECETA_POLLO_ID,
          title: 'Pollo con Arroz',
          categories: [],
          properties: [],
          nutritionalValues: null,
        },
      },
    };

    const mockClient = {
      ingredient: {
        upsert: jest.fn().mockImplementation(({ where, update, create }) => {
          const existing = existingDbState.ingredients[where.name as keyof typeof existingDbState.ingredients];
          if (existing) {
            return Promise.resolve({ ...existing, ...update });
          }
          return Promise.resolve({ id: 'new-id', ...create });
        }),
      },
      recipe: {
        upsert: jest.fn().mockImplementation(({ where, update, create }) => {
          const existing = existingDbState.recipes[where.id as keyof typeof existingDbState.recipes];
          if (existing) {
            return Promise.resolve({ ...existing, ...update });
          }
          return Promise.resolve({ id: where.id, ...create });
        }),
      },
    };

    // First execution: simulates seeding over pre-existing records with outdated/empty metadata
    const result = await seedBaseData(mockClient);

    expect(mockClient.ingredient.upsert).toHaveBeenCalledTimes(2);
    expect(mockClient.recipe.upsert).toHaveBeenCalledTimes(1);

    // Verify Pechuga update contains new metadata
    const pechugaCall = mockClient.ingredient.upsert.mock.calls.find(
      (c: any) => c[0].where.name === PECHUGA_POLLO_SEED.name,
    );
    expect(pechugaCall).toBeDefined();
    expect(pechugaCall[0].update).toEqual({
      type: PECHUGA_POLLO_SEED.type,
      description: PECHUGA_POLLO_SEED.description,
      defaultUnit: PECHUGA_POLLO_SEED.defaultUnit,
      nutritionalValues: PECHUGA_POLLO_SEED.nutritionalValues,
      properties: PECHUGA_POLLO_SEED.properties,
    });
    expect(pechugaCall[0].update.description).toBe(PECHUGA_POLLO_SEED.description);
    expect(pechugaCall[0].update.defaultUnit).toBe('g');
    expect(pechugaCall[0].update.nutritionalValues.sodium).toBe(74);
    expect(result.pechuga.description).toBe(PECHUGA_POLLO_SEED.description);
    expect(result.pechuga.defaultUnit).toBe('g');

    // Verify Arroz update contains fiber and properties
    const arrozCall = mockClient.ingredient.upsert.mock.calls.find(
      (c: any) => c[0].where.name === ARROZ_INTEGRAL_SEED.name,
    );
    expect(arrozCall).toBeDefined();
    expect(arrozCall[0].update.nutritionalValues.fiber).toBe(1.8);
    expect(arrozCall[0].update.properties).toEqual(['Sin Gluten', 'Alto en Fibra']);
    expect(result.arroz.nutritionalValues.fiber).toBe(1.8);

    // Verify Recipe update contains categories, properties and nutritionalValues
    expect(mockClient.recipe.upsert).toHaveBeenCalledWith({
      where: { id: RECETA_POLLO_ID },
      update: RECETA_POLLO_SEED,
      create: {
        id: RECETA_POLLO_ID,
        ...RECETA_POLLO_SEED,
      },
    });
    expect(result.recipePollo.categories).toEqual(RECETA_POLLO_SEED.categories);

    // Second execution: tests idempotency
    const secondResult = await seedBaseData(mockClient);
    expect(secondResult.pechuga.description).toBe(PECHUGA_POLLO_SEED.description);
    expect(secondResult.arroz.properties).toEqual(ARROZ_INTEGRAL_SEED.properties);
    expect(secondResult.recipePollo.title).toBe(RECETA_POLLO_SEED.title);
  });
});
