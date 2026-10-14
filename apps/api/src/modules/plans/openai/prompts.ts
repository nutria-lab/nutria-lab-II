import type { JsonSchema } from '../../openai/openai-schema';
import { RecipeCategory } from '../../../generated/prisma/client';

// Schema de una comida (título, macros y receta), compartido por el plan semanal y el reemplazo.
const mealContentProperties = {
  title: { type: 'string' },
  nutritionalValues: {
    type: 'object',
    properties: {
      Protein: { type: 'integer' },
      Fiber: { type: 'integer' },
      Calories: { type: 'integer' },
      Description: { type: 'string' },
    },
  },
  recipe: {
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
            quantity: { type: 'string' },
            unit: { type: 'string' },
          },
        },
      },
      instructions: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  },
} as const;

const weeklyMealContentProperties = {
  ...mealContentProperties,
  title: { ...mealContentProperties.title, description: 'Brief, descriptive dish name.' },
  nutritionalValues: {
    ...mealContentProperties.nutritionalValues,
    required: ['Protein', 'Fiber', 'Calories', 'Description'],
  },
  recipe: {
    ...mealContentProperties.recipe,
    properties: {
      ...mealContentProperties.recipe.properties,
      title: { ...mealContentProperties.recipe.properties.title, description: 'Brief, descriptive recipe name.' },
      ingredients: {
        ...mealContentProperties.recipe.properties.ingredients,
        items: {
          ...mealContentProperties.recipe.properties.ingredients.items,
          required: ['name', 'quantity', 'unit'],
        },
      },
      instructions: { ...mealContentProperties.recipe.properties.instructions },
    },
    required: ['title', 'description', 'prepMinutes', 'cookMinutes', 'ingredients', 'instructions'],
  },
};

function profileLines(profile: any): string {
  return `
        - Dieta: ${profile.diet || 'Sin dieta específica'}
        - Objetivo: ${profile.goal || 'General'}
        - Ingredientes excluidos: ${profile.excludedIngredients?.length > 0 ? profile.excludedIngredients.join(', ') : 'Ninguno'}
        - Tiempo preferido de cocción: ${profile.cookTimePreference || 'Cualquiera'}`;
}

export const PROMPT_VERSIONS = {
  v1: {
    version: '1.3.0-openai-structured-output',
    schemaVersion: '1.3.0-openai-structured-output',

    getPrompt(profile: any, startDate: string): string {
      return `
        Genera un plan de comidas de 7 días comenzando desde ${startDate}.
        Perfil del usuario:${profileLines(profile)}

        Reglas estrictas:
        1. Devuelve un JSON válido acorde al esquema.
        2. NUNCA incluyas ingredientes que estén en la lista de excluidos (y sus derivados).
        3. Proporciona macros coherentes.
        4. Los días deben ser desde el día 1 al día 7 de la semana solicitada.
        5. Usa títulos breves y descriptivos para las comidas y sus recetas.
        6. Cada día debe incluir exactamente una comida de cada tipo: BREAKFAST (desayuno), LUNCH (almuerzo), SNACK (merienda) y DINNER (cena), 28 comidas en total.
      `;
    },

    getSchema(): JsonSchema {
      return {
        type: 'object',
        properties: {
          days: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day: {
                  type: 'string',
                  enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
                },
                date: { type: 'string' },
                meals: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      mealType: {
                        type: 'string',
                        enum: ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'],
                      },
                      ...weeklyMealContentProperties,
                    },
                    required: ['mealType', 'title', 'nutritionalValues', 'recipe'],
                  },
                },
              },
              required: ['day', 'date', 'meals'],
            },
          },
        },
        required: ['days'],
      } as JsonSchema;
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
  version: 'replacement-1.1.0-openai',
  schemaVersion: 'replacement-1.1.0-openai',

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
  getSchema(): JsonSchema {
    return {
      type: 'object',
      properties: {
        ...mealContentProperties,
        recipe: {
          ...mealContentProperties.recipe,
          properties: {
            ...mealContentProperties.recipe.properties,
            categories: {
              type: 'array',
              items: { type: 'string', enum: Object.values(RecipeCategory) },
            },
            properties: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      required: ['title', 'nutritionalValues', 'recipe'],
    } as JsonSchema;
  },
};
