import { Injectable, InternalServerErrorException, RequestTimeoutException, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import { NutritionProfile, DayOfWeek, MealType } from '../../../generated/prisma/client';
import { CURRENT_PROMPT_VERSION, REPLACEMENT_PROMPT_VERSION, ReplacementPromptCriteria } from './prompts';

/**
 * `provider`/`model` de `GenerationRun` (design.md sección 3/6). Se declaran acá, junto al
 * único adaptador de IA real que existe hoy, en vez de hardcodearlos como literales sueltos en
 * `plans.service.ts`. Nota de discrepancia documentada en design.md sección 1: el código real
 * usa Gemini (`@google/generative-ai`), no OpenAI.
 */
export const GEMINI_PROVIDER = 'google-generative-ai';
export const GEMINI_MODEL_NAME = 'gemini-1.5-flash';

export interface GeneratedMealPlanDay {
  day: DayOfWeek;
  date: string;
  meals: Array<{
    mealType: MealType;
    title: string;
    nutritionalValues: { Protein: number; Fiber: number; Calories: number; Description: string };
    recipe?: {
      title: string;
      description: string;
      prepMinutes: number;
      cookMinutes: number;
      ingredients: Array<{ name: string; quantity: number | string; unit: string }>;
      instructions: string[];
    };
  }>;
}

// Comida generada para reemplazar otra: como una comida del plan, sin mealType y con la receta clasificada.
type GeneratedPlanMeal = GeneratedMealPlanDay['meals'][number];
export type GeneratedReplacementMeal = Omit<GeneratedPlanMeal, 'mealType' | 'recipe'> & {
  recipe?: NonNullable<GeneratedPlanMeal['recipe']> & { categories?: string[]; properties?: string[] };
};

// Gemini no respondió a tiempo o falló: el reemplazo de una comida lo traduce a 503.
export class AiProviderUnavailableError extends Error {
  constructor(readonly reason: 'AI_TIMEOUT' | 'AI_PROVIDER_ERROR') {
    super(`AI provider unavailable: ${reason}`);
    this.name = 'AiProviderUnavailableError';
  }
}

@Injectable()
export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private readonly logger = new Logger(GeminiService.name);

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is missing');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateMealPlan(profile: NutritionProfile, startDate: Date): Promise<GeneratedMealPlanDay[]> {
    const promptConfig = CURRENT_PROMPT_VERSION;
    
    this.logger.log(`Generating meal plan with prompt version: ${promptConfig.version}`);

    const model = this.genAI.getGenerativeModel({
      model: GEMINI_MODEL_NAME,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: promptConfig.getSchema(),
      }
    });

    const prompt = promptConfig.getPrompt(profile, startDate.toISOString().split('T')[0]);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 15000);

    try {
      const result = await model.generateContent(
        { contents: [{ role: 'user', parts: [{ text: prompt }] }] }, 
        { requestOptions: { signal: abortController.signal } } as any
      );
      
      clearTimeout(timeoutId);
      const text = result.response.text();
      const parsed = JSON.parse(text);
      
      return parsed.days as GeneratedMealPlanDay[];
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new RequestTimeoutException('AI generation timed out');
      }
      throw new InternalServerErrorException('Error generating AI plan');
    }
  }

  // Genera UNA comida para reemplazar otra del plan. El timeout cubre toda la respuesta: la
  // promesa del SDK recién se resuelve con el body completo. Si Gemini falla o no responde lanza
  // AiProviderUnavailableError; si responde algo que no es JSON devuelve null (lo rechaza el servicio).
  async generateReplacementMeal(
    profile: NutritionProfile,
    mealType: MealType,
    criteria: ReplacementPromptCriteria,
  ): Promise<GeneratedReplacementMeal | null> {
    const model = this.genAI.getGenerativeModel({
      model: GEMINI_MODEL_NAME,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: REPLACEMENT_PROMPT_VERSION.getSchema(),
      },
    });
    const prompt = REPLACEMENT_PROMPT_VERSION.getPrompt(profile, mealType, criteria);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 15000);

    let text: string;
    try {
      const result = await model.generateContent(
        { contents: [{ role: 'user', parts: [{ text: prompt }] }] },
        { requestOptions: { signal: abortController.signal } } as any,
      );
      text = result.response.text();
    } catch (error: any) {
      throw new AiProviderUnavailableError(error?.name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR');
    } finally {
      clearTimeout(timeoutId);
    }

    try {
      return JSON.parse(text) as GeneratedReplacementMeal;
    } catch {
      return null;
    }
  }
}
