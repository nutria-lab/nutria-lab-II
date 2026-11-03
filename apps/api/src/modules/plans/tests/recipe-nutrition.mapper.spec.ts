const { mapRecipeNutritionToMeal } = require('../recipe-nutrition.mapper') as {
  mapRecipeNutritionToMeal: (recipe: unknown) => Record<string, unknown>;
};

describe('mapRecipeNutritionToMeal', () => {
  const completeRecipe = {
    description: 'Almuerzo completo',
    nutritionalValues: { calories: 350, protein: 20, fiber: 8 },
  };

  it('maps the selected Recipe values into the PlannedMeal contract', () => {
    expect(mapRecipeNutritionToMeal(completeRecipe)).toEqual({
      Calories: 350,
      Protein: 20,
      Fiber: 8,
      Description: 'Almuerzo completo',
    });
  });

  it.each(['calories', 'protein', 'fiber', 'description'] as const)(
    'rejects the candidate when required source field %s is absent instead of filling a default',
    field => {
      const recipe: any = structuredClone(completeRecipe);
      if (field === 'description') delete recipe.description;
      else delete recipe.nutritionalValues[field];

      expect(() => mapRecipeNutritionToMeal(recipe)).toThrow();
    },
  );

  it('preserves legitimate measured zero values', () => {
    expect(mapRecipeNutritionToMeal({
      description: 'Sin fibra',
      nutritionalValues: { calories: 0, protein: 0, fiber: 0 },
    })).toEqual({ Calories: 0, Protein: 0, Fiber: 0, Description: 'Sin fibra' });
  });
});
