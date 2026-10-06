// Fixtures determinísticos de NUT-74: una receta generada válida y variantes que rompen una sola regla.

// 4·14 + 4·62 + 9·12 = 412 kcal esperadas: 410 está dentro del 15 %.
export function generatedRecipe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Ensalada de quinoa',
    description: 'Quinoa con vegetales frescos',
    prepMinutes: 15,
    cookMinutes: 10,
    ingredients: [
      { name: 'Quinoa', quantity: 150, unit: 'g' },
      { name: 'Tomate', quantity: 2, unit: 'unidad' },
    ],
    instructions: ['Cocinar la quinoa', 'Mezclar con los vegetales'],
    categories: ['VEGAN'],
    properties: ['Alto en fibra'],
    nutritionalValues: { calories: 410, protein: 14, carbs: 62, fat: 12 },
    ...overrides,
  };
}

// Receta con un solo ingrediente (para probar el texto de ese ingrediente sin ruido).
export function recipeWithIngredient(name: string, overrides: Record<string, unknown> = {}) {
  return generatedRecipe({
    title: 'Plato del día',
    description: 'Receta de prueba',
    categories: [],
    ingredients: [{ name, quantity: 100, unit: 'g' }],
    ...overrides,
  });
}

// Comida del plan semanal / del reemplazo, con los macros en la forma que devuelve Gemini.
export function generatedMeal(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Wok de verduras',
    nutritionalValues: { Protein: 18, Fiber: 7, Calories: 420, Description: 'Cena liviana' },
    recipe: {
      title: 'Wok de verduras',
      description: 'Verduras salteadas',
      prepMinutes: 15,
      cookMinutes: 10,
      ingredients: [{ name: 'Brócoli', quantity: 200, unit: 'g' }],
      instructions: ['Saltear las verduras'],
    },
    ...overrides,
  };
}

export const NO_RESTRICTIONS = { excludedIngredients: [] as string[] };
