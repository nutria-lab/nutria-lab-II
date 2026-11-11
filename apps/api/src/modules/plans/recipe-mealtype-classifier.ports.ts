import { Injectable } from '@nestjs/common';
import { MealType } from '@/generated/prisma/client';
import { JsonSchema } from '@/modules/openai/openai-schema';
import { OpenAIService } from '@/modules/openai/openai.service';

export const RECIPE_MEALTYPE_CLASSIFICATION_PROVIDER = Symbol('RECIPE_MEALTYPE_CLASSIFICATION_PROVIDER');
export const MEALTYPE_CLASSIFICATION_PROMPT_VERSION = 'recipe-mealtype-classification-v1';
export const MEALTYPE_CLASSIFICATION_SCHEMA_VERSION = 'recipe-mealtype-classification-v1';

export interface RecipeMealTypeClassificationInput {
  title: string;
  ingredients: unknown;
}

export interface RecipeMealTypeClassificationProvider {
  classify(
    recipes: readonly RecipeMealTypeClassificationInput[],
    onModelSelected?: (model: string) => void | Promise<void>,
  ): Promise<string>;
}

@Injectable()
export class OpenAIMealTypeClassificationProvider implements RecipeMealTypeClassificationProvider {
  constructor(private readonly openai: OpenAIService) {}

  classify(
    recipes: readonly RecipeMealTypeClassificationInput[],
    onModelSelected?: (model: string) => void | Promise<void>,
  ): Promise<string> {
    const prompt = JSON.stringify({
      task: 'Classify existing recipes by compatible meal type only',
      instructions: [
        'Use only each recipe title and ingredients to identify compatible meal types.',
        'Return one classification array for each recipe, in the same order as the input.',
        'Use only BREAKFAST, LUNCH, SNACK, or DINNER. Return an empty array only when none is compatible.',
        'If a recipe cannot be classified, refuse instead of guessing.',
        'Do not generate or modify recipes, macros, or explanations.',
      ],
      promptVersion: MEALTYPE_CLASSIFICATION_PROMPT_VERSION,
      schemaVersion: MEALTYPE_CLASSIFICATION_SCHEMA_VERSION,
      recipes: recipes.map(({ title, ingredients }) => ({ title, ingredients })),
      outputContract: {
        version: MEALTYPE_CLASSIFICATION_SCHEMA_VERSION,
        required: ['classifications'],
      },
    });

    return this.openai.generateJson(
      prompt,
      mealTypeClassificationSchema,
      'recipe_mealtype_classifications',
      onModelSelected,
    );
  }
}

const mealTypeClassificationSchema: JsonSchema = {
  type: 'object',
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'array',
        items: { type: 'string', enum: Object.values(MealType) },
      },
    },
  },
};
