import { Schema, SchemaType } from '@google/generative-ai';

export const PROMPT_VERSIONS = {
  v1: {
    version: '1.0.0',
    schemaVersion: '1.0.0',

    getPrompt(profile: any, startDate: string): string {
      return `
        Genera un plan de comidas de 7 días comenzando desde ${startDate}.
        Perfil del usuario:
        - Dieta: ${profile.diet || 'Sin dieta específica'}
        - Objetivo: ${profile.goal || 'General'}
        - Ingredientes excluidos: ${profile.excludedIngredients?.length > 0 ? profile.excludedIngredients.join(', ') : 'Ninguno'}
        - Tiempo preferido de cocción: ${profile.cookTimePreference || 'Cualquiera'}
        
        Reglas estrictas:
        1. Devuelve un JSON válido acorde al esquema.
        2. NUNCA incluyas ingredientes que estén en la lista de excluidos (y sus derivados).
        3. Proporciona macros coherentes.
        4. Los días deben ser desde el día 1 al día 7 de la semana solicitada.
      `;
    },

    getSchema(): Schema {
      return {
        type: SchemaType.OBJECT,
        properties: {
          days: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                day: {
                  type: SchemaType.STRING,
                  format: 'enum',
                  enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
                },
                date: { type: SchemaType.STRING },
                meals: {
                  type: SchemaType.ARRAY,
                  items: {
                    type: SchemaType.OBJECT,
                    properties: {
                      mealType: {
                        type: SchemaType.STRING,
                        format: 'enum',
                        enum: ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'],
                      },
                      title: { type: SchemaType.STRING },
                      nutritionalValues: {
                        type: SchemaType.OBJECT,
                        properties: {
                          Protein: { type: SchemaType.INTEGER },
                          Fiber: { type: SchemaType.INTEGER },
                          Calories: { type: SchemaType.INTEGER },
                          Description: { type: SchemaType.STRING },
                        },
                      },
                      recipe: {
                        type: SchemaType.OBJECT,
                        properties: {
                          title: { type: SchemaType.STRING },
                          description: { type: SchemaType.STRING },
                          prepMinutes: { type: SchemaType.INTEGER },
                          cookMinutes: { type: SchemaType.INTEGER },
                          ingredients: {
                            type: SchemaType.ARRAY,
                            items: {
                              type: SchemaType.OBJECT,
                              properties: {
                                name: { type: SchemaType.STRING },
                                quantity: { type: SchemaType.STRING },
                                unit: { type: SchemaType.STRING },
                              },
                            },
                          },
                          instructions: {
                            type: SchemaType.ARRAY,
                            items: { type: SchemaType.STRING },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        required: ['days'],
      };
    },
  },
};

export const CURRENT_PROMPT_VERSION = PROMPT_VERSIONS.v1;