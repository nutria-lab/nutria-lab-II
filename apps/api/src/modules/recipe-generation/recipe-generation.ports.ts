import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AiProviderUnavailableError, GEMINI_MODEL_NAME, GEMINI_REQUEST_TIMEOUT_MS } from '@/modules/plans/gemini/gemini.constants';

export const RECIPE_GENERATION_PROVIDER = Symbol('RECIPE_GENERATION_PROVIDER');

export interface RecipeGenerationProvider {
  generate(input: { profile: unknown; criteria: unknown; count: number; promptVersion: string; schemaVersion: string }): Promise<string>;
}

@Injectable()
export class GeminiRecipeGenerationProvider implements RecipeGenerationProvider {
  private readonly client: GoogleGenerativeAI;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('GEMINI_API_KEY');
    if (!apiKey) throw new Error('GEMINI_API_KEY is missing');
    this.client = new GoogleGenerativeAI(apiKey);
  }

  generate(input: { profile: unknown; criteria: unknown; count: number; promptVersion: string; schemaVersion: string }): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: GEMINI_MODEL_NAME,
      generationConfig: { responseMimeType: 'application/json', responseSchema: recipeResponseSchema as never },
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);
    const request = (async () => {
      try {
        const result = await model.generateContent(
          { contents: [{ role: 'user', parts: [{ text: JSON.stringify({ task: 'Generate structured recipe candidates only', count: input.count, criteria: input.criteria, profile: input.profile, promptVersion: input.promptVersion, schemaVersion: input.schemaVersion, outputContract: { version: input.schemaVersion, required: ['recipes'] } }) }] }] },
          { signal: controller.signal },
        );
        return result.response.text();
      } catch (error) {
        if ((error as { status?: unknown })?.status === 429) {
          throw Object.assign(new AiProviderUnavailableError('AI_PROVIDER_ERROR'), { code: 'RATE_LIMITED' });
        }
        throw new AiProviderUnavailableError(controller.signal.aborted ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR');
      } finally {
        clearTimeout(timeout);
      }
    })();
    request.then(undefined, () => undefined);
    return request;
  }
}

const recipeResponseSchema = {
  type: 'OBJECT', required: ['recipes'], properties: {
    recipes: {
      type: 'ARRAY', items: {
        type: 'OBJECT',
        required: ['title', 'description', 'prepMinutes', 'cookMinutes', 'ingredients', 'instructions', 'categories', 'nutritionalValues', 'properties'],
        properties: {
          title: { type: 'STRING' }, description: { type: 'STRING' }, prepMinutes: { type: 'INTEGER' }, cookMinutes: { type: 'INTEGER' },
          ingredients: { type: 'ARRAY', items: { type: 'OBJECT' } }, instructions: { type: 'ARRAY', items: { type: 'STRING' } },
          categories: { type: 'ARRAY', items: { type: 'STRING' } }, nutritionalValues: { type: 'OBJECT' }, properties: { type: 'ARRAY', items: { type: 'STRING' } },
        },
      },
    },
  },
} as const;

/** Provider-neutral safe default until a concrete adapter is configured. */
export class UnavailableRecipeGenerationProvider implements RecipeGenerationProvider {
  async generate(): Promise<never> {
    throw Object.assign(new Error('Recipe generation provider is not integrated'), { status: 503 });
  }
}
