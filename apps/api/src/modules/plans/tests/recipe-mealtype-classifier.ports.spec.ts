import 'reflect-metadata';
import { MealType } from '../../../generated/prisma/client';
import { toStrictJsonSchema } from '../../openai/openai-schema';
import {
  MEALTYPE_CLASSIFICATION_PROMPT_VERSION,
  MEALTYPE_CLASSIFICATION_SCHEMA_VERSION,
  OpenAIMealTypeClassificationProvider,
} from '../recipe-mealtype-classifier.ports';

describe('OpenAIMealTypeClassificationProvider (NUT-76)', () => {
  it('makes one strict structured-output call per page with only ordered title and ingredient data', async () => {
    const openai = { generateJson: jest.fn().mockResolvedValue('{"classifications":[["BREAKFAST"],[]]}') };
    const provider = new OpenAIMealTypeClassificationProvider(openai as any);
    const page = [
      {
        id: 'must-not-leak-recipe-id',
        title: 'Avena con fruta',
        ingredients: [{ name: 'Avena', quantity: 40, unit: 'g' }],
        categories: ['must-not-leak-category'],
        properties: ['must-not-leak-property'],
        userProfile: { excludedIngredients: ['must-not-leak-profile'] },
      },
      {
        id: 'second-private-id',
        title: 'Ensalada tibia',
        ingredients: [{ name: 'Lentejas', quantity: 100, unit: 'g' }],
        categories: [],
        properties: [],
      },
    ];

    await provider.classify(page as any);

    expect(openai.generateJson).toHaveBeenCalledTimes(1);
    const [prompt, schema, schemaName] = openai.generateJson.mock.calls[0];
    expect(schemaName).toBe('recipe_mealtype_classifications');
    const strictSchema = toStrictJsonSchema(schema) as any;
    expect(strictSchema.properties.classifications).toMatchObject({
      type: 'array',
      items: {
        type: 'array',
        items: { type: 'string', enum: Object.values(MealType) },
      },
    });
    expect(strictSchema.additionalProperties).toBe(false);
    expect(strictSchema.required).toEqual(['classifications']);
    expect(prompt).toContain(MEALTYPE_CLASSIFICATION_PROMPT_VERSION);
    expect(prompt).toContain(MEALTYPE_CLASSIFICATION_SCHEMA_VERSION);
    for (const privateValue of [
      'must-not-leak-recipe-id', 'second-private-id', 'must-not-leak-category',
      'must-not-leak-property', 'must-not-leak-profile',
    ]) {
      expect(prompt).not.toContain(privateValue);
    }
    expect(prompt).toContain('Avena con fruta');
    expect(prompt).toContain('Avena');
    expect(prompt).toContain('Ensalada tibia');
    expect(prompt).toContain('Lentejas');
  });

  it('passes model selection through the shared OpenAI boundary for separate classification audit', async () => {
    const onModelSelected = jest.fn();
    const openai = { generateJson: jest.fn().mockResolvedValue('{"classifications":[[]]}') };
    const provider = new OpenAIMealTypeClassificationProvider(openai as any);

    await provider.classify([{ title: 'Sopa', ingredients: [{ name: 'Calabaza' }] }], onModelSelected);

    expect(openai.generateJson).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: 'object' }),
      'recipe_mealtype_classifications',
      onModelSelected,
    );
  });
});
