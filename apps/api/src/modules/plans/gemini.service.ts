import { Injectable, InternalServerErrorException, RequestTimeoutException } from '@nestjs/common';
import { GoogleGenerativeAI, Schema, SchemaType } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import { NutritionProfile, DayOfWeek, MealType } from '../../generated/prisma/client';

export interface GeneratedMealPlanDay {
  day: DayOfWeek;
  date: string;
  meals: Array<{
    mealType: MealType;
    title: string;
    nutritionalValues: { Protein: number; Fiber: number; Calories: number; Description: string };
    recipe?: { prepMinutes: number; cookMinutes: number; steps: string[] };
  }>;
}

@Injectable()
export class GeminiService {
  private genAI: GoogleGenerativeAI;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is missing');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateMealPlan(profile: NutritionProfile, startDate: Date): Promise<GeneratedMealPlanDay[]> {
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: this.getSchema(),
      }
    });

    const prompt = `
      Genera un plan de comidas de 7 días comenzando desde ${startDate.toISOString().split('T')[0]}.
      Perfil del usuario:
      - Dieta: ${profile.diet || 'Sin dieta específica'}
      - Objetivo: ${profile.goal || 'General'}
      - Ingredientes excluidos: ${profile.excludedIngredients.length > 0 ? (profile.excludedIngredients as string[]).join(', ') : 'Ninguno'}
      - Tiempo preferido de cocción: ${profile.cookTimePreference || 'Cualquiera'}
      
      Reglas estrictas:
      1. Devuelve un JSON válido acorde al esquema.
      2. NUNCA incluyas ingredientes que estén en la lista de excluidos (y sus derivados).
      3. Proporciona macros coherentes.
      4. Los días deben ser desde el día 1 al día 7 de la semana solicitada.
    `;

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

  private getSchema(): Schema {
    return {
      type: SchemaType.OBJECT,
      properties: {
        days: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              day: { type: SchemaType.STRING, format: 'enum', enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] },
              date: { type: SchemaType.STRING },
              meals: {
                type: SchemaType.ARRAY,
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    mealType: { type: SchemaType.STRING, format: 'enum', enum: ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'] },
                    title: { type: SchemaType.STRING },
                    nutritionalValues: {
                      type: SchemaType.OBJECT,
                      properties: {
                        Protein: { type: SchemaType.INTEGER },
                        Fiber: { type: SchemaType.INTEGER },
                        Calories: { type: SchemaType.INTEGER },
                        Description: { type: SchemaType.STRING }
                      }
                    },
                    recipe: {
                      type: SchemaType.OBJECT,
                      properties: {
                        prepMinutes: { type: SchemaType.INTEGER },
                        cookMinutes: { type: SchemaType.INTEGER },
                        steps: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      required: ['days']
    };
  }
}
