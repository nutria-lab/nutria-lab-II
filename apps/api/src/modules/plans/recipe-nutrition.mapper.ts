type RecipeNutritionSource = {
  description?: unknown;
  nutritionalValues?: unknown;
};

export function mapRecipeNutritionToMeal(recipe: unknown): {
  Calories: number;
  Protein: number;
  Fiber: number;
  Description: string;
} {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    throw new TypeError('Recipe is required to map meal nutrition');
  }

  const source = recipe as RecipeNutritionSource;
  const nutrition = source.nutritionalValues;
  if (!nutrition || typeof nutrition !== 'object' || Array.isArray(nutrition)) {
    throw new TypeError('Recipe nutrition is required to map meal nutrition');
  }

  const values = nutrition as Record<string, unknown>;
  const calories = values.calories;
  const protein = values.protein;
  const fiber = values.fiber;
  const description = source.description;
  if (![calories, protein, fiber].every(value => typeof value === 'number' && Number.isFinite(value))) {
    throw new TypeError('Recipe calories, protein, and fiber are required to map meal nutrition');
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw new TypeError('Recipe description is required to map meal nutrition');
  }

  return {
    Calories: calories as number,
    Protein: protein as number,
    Fiber: fiber as number,
    Description: description,
  };
}
