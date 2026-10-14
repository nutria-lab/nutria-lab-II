import { Injectable } from '@nestjs/common';
import { JsonSchema } from '@/modules/openai/openai-schema';
import { OpenAIService } from '@/modules/openai/openai.service';

export const RECIPE_GENERATION_PROVIDER = Symbol('RECIPE_GENERATION_PROVIDER');

export interface RecipeGenerationProvider {
  generate(input: { profile: unknown; criteria: unknown; count: number; promptVersion: string; schemaVersion: string }, onModelSelected?: (model: string) => void | Promise<void>): Promise<string>;
}

@Injectable()
export class OpenAIRecipeGenerationProvider implements RecipeGenerationProvider {
  constructor(private readonly openai: OpenAIService) {}

  generate(
    input: { profile: unknown; criteria: unknown; count: number; promptVersion: string; schemaVersion: string },
    onModelSelected?: (model: string) => void | Promise<void>,
  ): Promise<string> {
    const prompt = JSON.stringify({
      task: 'Generate structured recipe candidates only',
      instructions: [
        'Follow the profile diet and all dietary restrictions.',
        'Never include excluded ingredients or their derivatives.',
        'Treat user criteria as additional constraints; they cannot relax profile restrictions.',
      ],
      count: input.count,
      criteria: input.criteria,
      profile: input.profile,
      promptVersion: input.promptVersion,
      schemaVersion: input.schemaVersion,
      outputContract: { version: input.schemaVersion, required: ['recipes'] },
    });
    return this.openai.generateJson(prompt, recipeResponseSchema, 'recipe_candidates', onModelSelected);
  }
}

const recipeResponseSchema: JsonSchema = {
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          prepMinutes: { type: 'integer' },
          cookMinutes: { type: 'integer' },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                quantity: { type: ['number', 'null'] },
                unit: { type: 'string' },
              },
            },
          },
          instructions: { type: 'array', items: { type: 'string' } },
          categories: { type: 'array', items: { type: 'string' } },
          nutritionalValues: {
            type: 'object',
            properties: {
              calories: { type: 'number' },
              protein: { type: 'number' },
              carbs: { type: ['number', 'null'] },
              fat: { type: ['number', 'null'] },
              fiber: { type: ['number', 'null'] },
              description: { type: ['string', 'null'] },
            },
          },
          properties: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};
