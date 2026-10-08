import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI, Schema } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import { NutritionProfile, MealType } from '../../../generated/prisma/client';
import { CURRENT_PROMPT_VERSION, REPLACEMENT_PROMPT_VERSION, ReplacementPromptCriteria } from './prompts';

/**
 * `provider`/`model` de `GenerationRun` (design.md sección 3/6). Se declaran acá, junto al
 * único adaptador de IA real que existe hoy, en vez de hardcodearlos como literales sueltos en
 * `plans.service.ts`. Nota de discrepancia documentada en design.md sección 1: el código real
 * usa Gemini (`@google/generative-ai`), no OpenAI.
 */
export { AiProviderUnavailableError, GEMINI_MODEL_NAME, GEMINI_PROVIDER } from './gemini.constants';
import { AiProviderUnavailableError, GEMINI_MODEL_NAME, GEMINI_REQUEST_TIMEOUT_MS } from './gemini.constants';

// Gemini no respondió a tiempo o falló: los servicios lo traducen a 503.
// Adaptador de Gemini. Devuelve el texto crudo y nunca lo parsea: la respuesta es output no
// confiable hasta que la valida el servidor (NUT-74). Las fallas del proveedor siempre son
// AiProviderUnavailableError.
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

  async generateMealPlan(profile: NutritionProfile, startDate: Date): Promise<string> {
    const promptConfig = CURRENT_PROMPT_VERSION;
    this.logger.log(`Generating meal plan with prompt version: ${promptConfig.version}`);

    const prompt = promptConfig.getPrompt(profile, startDate.toISOString().split('T')[0]);
    return this.generateText(promptConfig.getSchema(), prompt);
  }

  // Genera UNA comida para reemplazar otra del plan (NUT-77).
  async generateReplacementMeal(
    profile: NutritionProfile,
    mealType: MealType,
    criteria: ReplacementPromptCriteria,
  ): Promise<string> {
    const prompt = REPLACEMENT_PROMPT_VERSION.getPrompt(profile, mealType, criteria);
    return this.generateText(REPLACEMENT_PROMPT_VERSION.getSchema(), prompt);
  }

  // El timeout cubre toda la respuesta: la promesa del SDK recién se resuelve con el body completo.
  private async generateText(responseSchema: Schema, prompt: string): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: GEMINI_MODEL_NAME,
      generationConfig: { responseMimeType: 'application/json', responseSchema },
    });

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), GEMINI_REQUEST_TIMEOUT_MS);

    try {
      // El SDK lee `signal` en el primer nivel de las opciones (SingleRequestOptions).
      const result = await model.generateContent(
        { contents: [{ role: 'user', parts: [{ text: prompt }] }] },
        { signal: abortController.signal },
      );
      return result.response.text();
    } catch {
      // Al abortar, el SDK lanza GoogleGenerativeAIAbortError (su name no es 'AbortError'): se mira la señal.
      throw new AiProviderUnavailableError(abortController.signal.aborted ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR');
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
