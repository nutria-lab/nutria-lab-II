import { Schema, SchemaType } from '@google/generative-ai';
import { RecipeCategory } from '../../../generated/prisma/client';

// Schema de una comida (título, macros y receta), compartido por el plan semanal y el reemplazo.
const mealContentProperties = {
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
} as const;

function profileLines(profile: any): string {
  return `
        - Dieta: ${profile.diet || 'Sin dieta específica'}
        - Objetivo: ${profile.goal || 'General'}
        - Ingredientes excluidos: ${profile.excludedIngredients?.length > 0 ? profile.excludedIngredients.join(', ') : 'Ninguno'}
        - Tiempo preferido de cocción: ${profile.cookTimePreference || 'Cualquiera'}`;
}

export const PROMPT_VERSIONS = {
  v1: {
    version: '1.0.0',
    schemaVersion: '1.0.0',

    getPrompt(profile: any, startDate: string): string {
      return `
        Genera un plan de comidas de 7 días comenzando desde ${startDate}.
        Perfil del usuario:${profileLines(profile)}

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
                      ...mealContentProperties,
                    },
                  },
                },
              },
            },
          },
        },
        required: ['days'],
      } as Schema;
    },
  },
};

export const CURRENT_PROMPT_VERSION = PROMPT_VERSIONS.v1;

// Criterios opcionales del body de reemplazo, ya normalizados.
export interface ReplacementPromptCriteria {
  topic?: string;
  categories: string[];
  properties: string[];
  maxPrepMinutes?: number;
}

// Prompt para generar UNA comida que reemplaza a otra dentro de un plan (NUT-77).
export const REPLACEMENT_PROMPT_VERSION = {
  version: 'replacement-1.0.0',
  schemaVersion: 'replacement-1.0.0',

  getPrompt(profile: any, mealType: string, criteria: ReplacementPromptCriteria): string {
    const wishes = [
      criteria.topic ? `- Tema: ${criteria.topic}` : null,
      criteria.categories.length > 0 ? `- Categorías: ${criteria.categories.join(', ')}` : null,
      criteria.properties.length > 0 ? `- Propiedades: ${criteria.properties.join(', ')}` : null,
      criteria.maxPrepMinutes !== undefined ? `- Preparación de ${criteria.maxPrepMinutes} minutos como máximo` : null,
    ].filter(Boolean);

    return `
        Genera UNA sola comida de tipo ${mealType} con su receta, para reemplazar otra dentro de un plan semanal.
        Perfil del usuario:${profileLines(profile)}
        ${wishes.length > 0 ? `Pedidos del usuario:\n        ${wishes.join('\n        ')}` : ''}

        Reglas estrictas:
        1. Devuelve un JSON válido acorde al esquema.
        2. NUNCA incluyas ingredientes que estén en la lista de excluidos (y sus derivados).
        3. Respeta la dieta del perfil; los pedidos del usuario sólo pueden restringir más, nunca relajarla.
        4. Proporciona macros coherentes.
        5. Clasifica la receta en "categories" (sólo valores de la lista) y "properties". Incluye una
           categoría o propiedad pedida únicamente si la receta realmente la cumple.
      `;
  },

  // Igual que una comida del plan, pero la receta además trae categories y properties para validarlas.
  getSchema(): Schema {
    return {
      type: SchemaType.OBJECT,
      properties: {
        ...mealContentProperties,
        recipe: {
          ...mealContentProperties.recipe,
          properties: {
            ...mealContentProperties.recipe.properties,
            categories: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING, format: 'enum', enum: Object.values(RecipeCategory) },
            },
            properties: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          },
        },
      },
      required: ['title', 'nutritionalValues', 'recipe'],
    } as Schema;
  },
};
