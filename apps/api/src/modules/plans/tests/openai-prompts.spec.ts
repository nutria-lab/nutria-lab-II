const SchemaType = { OBJECT: 'object', ARRAY: 'array', STRING: 'string', INTEGER: 'integer' } as const;
import { RecipeCategory } from '../../../generated/prisma/client';
import { CURRENT_PROMPT_VERSION, REPLACEMENT_PROMPT_VERSION } from '../openai/prompts';

type SchemaNode = {
  type: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  required?: string[];
  minItems?: number;
  maxItems?: number;
  description?: string;
  enum?: string[];
  format?: string;
};

function weeklyNodes() {
  const root = CURRENT_PROMPT_VERSION.getSchema() as SchemaNode;
  const days = root.properties!.days;
  const day = days.items!;
  const meals = day.properties!.meals;
  const meal = meals.items!;
  const nutrition = meal.properties!.nutritionalValues;
  const recipe = meal.properties!.recipe;
  return { root, days, day, meals, meal, nutrition, recipe };
}

function expectAllPropertiesRequired(node: SchemaNode) {
  expect(node.required?.slice().sort()).toEqual(Object.keys(node.properties!).sort());
}

describe('weekly OpenAI prompt schema contract', () => {
  it('requires exactly seven days and every day field', () => {
    const { root, days, day } = weeklyNodes();
    expectAllPropertiesRequired(root);
    expect(days.minItems).toBeUndefined();
    expect(days.maxItems).toBeUndefined();
    expectAllPropertiesRequired(day);
    expect(day.properties!.meals.minItems).toBeUndefined();
    expect(day.properties!.meals.maxItems).toBeUndefined();
  });

  it('asks for exactly one of each supported meal type per day', () => {
    const prompt = CURRENT_PROMPT_VERSION.getPrompt({
      diet: 'ALL', goal: 'MAINTAIN', excludedIngredients: [], cookTimePreference: 'STANDARD',
    }, '2026-10-12');
    expect(prompt).toMatch(/cada día.*desayuno.*almuerzo.*merienda.*cena/i);
    expect(prompt).toMatch(/exactamente una.*cada tipo/i);
  });

  it('requires every meal field and existing nutritional value', () => {
    const { meal, nutrition } = weeklyNodes();
    expectAllPropertiesRequired(meal);
    expectAllPropertiesRequired(nutrition);
    expect(nutrition.required?.slice().sort()).toEqual(['Calories', 'Description', 'Fiber', 'Protein']);
  });

  it('requires all recipe fields', () => {
    const { recipe } = weeklyNodes();
    expectAllPropertiesRequired(recipe);
    expect(recipe.required?.slice().sort()).toEqual([
      'cookMinutes', 'description', 'ingredients', 'instructions', 'prepMinutes', 'title',
    ]);
  });

  it('requires nonempty ingredients and instructions and every ingredient field', () => {
    const { recipe } = weeklyNodes();
    const ingredients = recipe.properties!.ingredients;
    const instructions = recipe.properties!.instructions;
    expect(ingredients.minItems).toBeUndefined();
    expect(instructions.minItems).toBeUndefined();
    expectAllPropertiesRequired(ingredients.items!);
    expect(ingredients.items!.required?.slice().sort()).toEqual(['name', 'quantity', 'unit']);
    expect(instructions.items!.type).toBe(SchemaType.STRING);
  });

  it('preserves the existing field types and domain enums', () => {
    const { root, days, day, meals, meal, nutrition, recipe } = weeklyNodes();
    expect(root.type).toBe(SchemaType.OBJECT);
    expect(days.type).toBe(SchemaType.ARRAY);
    expect(day.type).toBe(SchemaType.OBJECT);
    expect(day.properties!.day).toMatchObject({
      type: SchemaType.STRING,
      enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
    });
    expect(day.properties!.date.type).toBe(SchemaType.STRING);
    expect(meals.type).toBe(SchemaType.ARRAY);
    expect(meal.type).toBe(SchemaType.OBJECT);
    expect(meal.properties!.mealType).toMatchObject({
      type: SchemaType.STRING, enum: ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'],
    });
    expect(meal.properties!.title.type).toBe(SchemaType.STRING);
    expect(nutrition.type).toBe(SchemaType.OBJECT);
    for (const field of ['Protein', 'Fiber', 'Calories']) {
      expect(nutrition.properties![field].type).toBe(SchemaType.INTEGER);
    }
    expect(nutrition.properties!.Description.type).toBe(SchemaType.STRING);
    expect(recipe.type).toBe(SchemaType.OBJECT);
    for (const field of ['title', 'description']) {
      expect(recipe.properties![field].type).toBe(SchemaType.STRING);
    }
    for (const field of ['prepMinutes', 'cookMinutes']) {
      expect(recipe.properties![field].type).toBe(SchemaType.INTEGER);
    }
    expect(recipe.properties!.ingredients.type).toBe(SchemaType.ARRAY);
    for (const field of ['name', 'quantity', 'unit']) {
      expect(recipe.properties!.ingredients.items!.properties![field].type).toBe(SchemaType.STRING);
    }
    expect(recipe.properties!.instructions.type).toBe(SchemaType.ARRAY);
  });

  it('guides concise titles and preserves supplied preferences and exclusions', () => {
    const { meal, recipe } = weeklyNodes();
    expect(meal.properties!.title.description).toEqual(expect.any(String));
    expect(recipe.properties!.title.description).toEqual(expect.any(String));
    expect(meal.properties!.title.description!.length).toBeGreaterThan(0);
    expect(recipe.properties!.title.description!.length).toBeGreaterThan(0);
    const profile = {
      diet: 'VEGETARIAN', goal: 'GAIN_MUSCLE', cookTimePreference: 'STANDARD',
      excludedIngredients: ['DAIRY', 'SHELLFISH'],
    };
    const original = JSON.parse(JSON.stringify(profile));
    const prompt = CURRENT_PROMPT_VERSION.getPrompt(profile, '2026-10-05');
    expect(prompt).toMatch(/títulos?.*(breves?|cortos?)/i);
    expect(prompt).toMatch(/descriptiv/i);
    expect(prompt).toMatch(/BREAKFAST/i);
    expect(prompt).toMatch(/LUNCH/i);
    expect(prompt).toMatch(/SNACK/i);
    expect(prompt).toMatch(/DINNER/i);
    expect(prompt).toMatch(/exactamente una/i);
    expect(prompt).toContain('2026-10-05');
    expect(prompt).toContain('- Dieta: VEGETARIAN');
    expect(prompt).toContain('- Objetivo: GAIN_MUSCLE');
    expect(prompt).toContain('- Tiempo preferido de cocción: STANDARD');
    expect(prompt).toContain('- Ingredientes excluidos: DAIRY, SHELLFISH');
    expect(prompt).toContain('NUNCA incluyas ingredientes');
    expect(profile).toEqual(original);
  });

  it('identifies the local weekly schema experiment', () => {
    expect(CURRENT_PROMPT_VERSION.version).toBe('1.3.0-openai-structured-output');
    expect(CURRENT_PROMPT_VERSION.schemaVersion).toBe('1.3.0-openai-structured-output');
  });
});

describe('replacement schema isolation', () => {
  it('preserves the complete existing replacement schema across weekly schema calls', () => {
    const string = { type: SchemaType.STRING };
    const integer = { type: SchemaType.INTEGER };
    const expected = {
      type: SchemaType.OBJECT,
      properties: {
        title: string,
        nutritionalValues: {
          type: SchemaType.OBJECT,
          properties: { Protein: integer, Fiber: integer, Calories: integer, Description: string },
        },
        recipe: {
          type: SchemaType.OBJECT,
          properties: {
            title: string, description: string, prepMinutes: integer, cookMinutes: integer,
            ingredients: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.OBJECT, properties: { name: string, quantity: string, unit: string } },
            },
            instructions: { type: SchemaType.ARRAY, items: string },
            categories: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING, enum: Object.values(RecipeCategory) },
            },
            properties: { type: SchemaType.ARRAY, items: string },
          },
        },
      },
      required: ['title', 'nutritionalValues', 'recipe'],
    };
    const before = REPLACEMENT_PROMPT_VERSION.getSchema();
    expect(before).toEqual(expected);
    CURRENT_PROMPT_VERSION.getSchema();
    CURRENT_PROMPT_VERSION.getSchema();
    expect(REPLACEMENT_PROMPT_VERSION.getSchema()).toEqual(before);
    expect(REPLACEMENT_PROMPT_VERSION.getSchema()).toEqual(expected);
    expect(REPLACEMENT_PROMPT_VERSION.version).toBe('replacement-1.1.0-openai');
    expect(REPLACEMENT_PROMPT_VERSION.schemaVersion).toBe('replacement-1.1.0-openai');
  });
});
