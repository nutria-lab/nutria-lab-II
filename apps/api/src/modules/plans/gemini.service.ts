import { Injectable, InternalServerErrorException, RequestTimeoutException } from '@nestjs/common';
import { GoogleGenerativeAI, Schema, SchemaType } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';

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

  async generateMealPlan(profile: any, startDate: Date): Promise<any[]> {
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
      - Restricciones/Alergias: ${profile.allergies || 'Ninguna'}
      - Tiempo preferido de cocción: ${profile.cookTimePreference || 'Cualquiera'}
      
      Reglas estrictas:
      1. Devuelve un JSON válido acorde al esquema.
      2. No incluyas ingredientes que violen las restricciones.
      3. Proporciona macros coherentes.
      4. Los días deben ser desde el día 1 al día 7.
    `;

    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new RequestTimeoutException('AI generation timed out')), 15000)
      );

      const aiPromise = model.generateContent(prompt);
      const result: any = await Promise.race([aiPromise, timeoutPromise]);
      
      const text = result.response.text();
      const parsed = JSON.parse(text);
      return parsed.days;
    } catch (error) {
      if (error instanceof RequestTimeoutException) throw error;
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
