import { RecipeCategory } from '@/generated/prisma/client';
import { OpenAIRecipeGenerationProvider, RECIPE_GENERATION_PROMPT_VERSION, RECIPE_GENERATION_SCHEMA_VERSION } from './recipe-generation.ports';

describe('OpenAIRecipeGenerationProvider output contract', () => {
  it('requires numeric fiber for weekly meal nutrition', async () => {
    const generateJson = jest.fn().mockResolvedValue('{"recipes":[]}');
    const provider = new OpenAIRecipeGenerationProvider({ generateJson } as never);

    await provider.generate({
      profile: { diet: 'VEGAN', excludedIngredients: [] },
      criteria: { mealType: 'DINNER' },
      count: 1,
      promptVersion: RECIPE_GENERATION_PROMPT_VERSION,
      schemaVersion: RECIPE_GENERATION_SCHEMA_VERSION,
    });

    const [rawPrompt, rawSchema] = generateJson.mock.calls[0];
    const prompt = JSON.parse(rawPrompt as string) as { outputContract: { required: string[] } };
    const schema = rawSchema as { properties: { recipes: { items: { properties: {
      nutritionalValues: { properties: { fiber: { type: string | string[] } } };
    } } } } };

    expect(schema.properties.recipes.items.properties.nutritionalValues.properties.fiber.type).toBe('number');
    expect(prompt.outputContract.required).toContain('recipes[].nutritionalValues.fiber');
  });

  it('constrains generated categories to the supported recipe enum', async () => {
    const generateJson = jest.fn().mockResolvedValue('{"recipes":[]}');
    const provider = new OpenAIRecipeGenerationProvider({ generateJson } as never);

    await provider.generate({
      profile: { diet: 'VEGAN', excludedIngredients: [] },
      criteria: {},
      count: 1,
      promptVersion: RECIPE_GENERATION_PROMPT_VERSION,
      schemaVersion: RECIPE_GENERATION_SCHEMA_VERSION,
    });

    const [rawPrompt, rawSchema] = generateJson.mock.calls[0];
    const prompt = JSON.parse(rawPrompt as string) as { instructions: string[] };
    const schema = rawSchema as {
      properties: {
        recipes: {
          items: { properties: { categories: { items: { enum?: string[] } } } };
        };
      };
    };
    const supportedCategories = Object.values(RecipeCategory);

    expect(RECIPE_GENERATION_PROMPT_VERSION).toBe('recipe-preview-openai-v3');
    expect(RECIPE_GENERATION_SCHEMA_VERSION).toBe('recipe-candidate-openai-v3');
    expect(prompt.instructions).toContain(
      `Use only these category values: ${supportedCategories.join(', ')}. Use an empty list if none applies.`,
    );
    expect(schema.properties.recipes.items.properties.categories.items.enum).toEqual(supportedCategories);
  });
});
