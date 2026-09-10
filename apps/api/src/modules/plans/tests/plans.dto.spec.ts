import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RecipeDto } from '../dto/recipe.dto';
import { MealDto } from '../dto/meal.dto';
import { NutritionalValuesDto } from '../dto/nutritional-values.dto';
import { MealType } from '../../../generated/prisma/client';

const validIngredient = { name: 'Pollo', quantity: 200, unit: 'g' };

const validRecipe = {
  title: 'Pollo al Horno',
  description: 'Receta saludable de pollo',
  prepMinutes: 10,
  cookMinutes: 30,
  ingredients: [validIngredient],
  instructions: 'Precalentar el horno y cocinar el pollo.',
};

const validNutritionalValues = {
  Protein: 35,
  Fiber: 5,
  Calories: 400,
  Description: 'Almuerzo alto en proteínas',
};

// ---------------------------------------------------------------------------
// RecipeDto
// ---------------------------------------------------------------------------
describe('RecipeDto', () => {
  it('acepta una receta completa válida', async () => {
    const dto = plainToInstance(RecipeDto, validRecipe);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza una receta sin ingredients', async () => {
    const dto = plainToInstance(RecipeDto, { ...validRecipe, ingredients: undefined });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'ingredients')).toBe(true);
  });

  it('rechaza una receta con ingredients vacío', async () => {
    const dto = plainToInstance(RecipeDto, { ...validRecipe, ingredients: [] });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'ingredients')).toBe(true);
  });

  it('rechaza una receta sin instructions', async () => {
    const dto = plainToInstance(RecipeDto, { ...validRecipe, instructions: undefined });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'instructions')).toBe(true);
  });

  it('rechaza prepMinutes negativo', async () => {
    const dto = plainToInstance(RecipeDto, { ...validRecipe, prepMinutes: -1 });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'prepMinutes')).toBe(true);
  });

  it('rechaza cookMinutes negativo', async () => {
    const dto = plainToInstance(RecipeDto, { ...validRecipe, cookMinutes: -5 });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'cookMinutes')).toBe(true);
  });

  it('rechaza un ingrediente sin name', async () => {
    const dto = plainToInstance(RecipeDto, {
      ...validRecipe,
      ingredients: [{ quantity: 200, unit: 'g' }],
    });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'ingredients')).toBe(true);
  });

  it('rechaza un ingrediente sin unit', async () => {
    const dto = plainToInstance(RecipeDto, {
      ...validRecipe,
      ingredients: [{ name: 'Pollo', quantity: 200 }],
    });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'ingredients')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NutritionalValuesDto
// ---------------------------------------------------------------------------
describe('NutritionalValuesDto', () => {
  it('acepta valores nutricionales completos', async () => {
    const dto = plainToInstance(NutritionalValuesDto, validNutritionalValues);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza valores nutricionales sin Calories', async () => {
    const dto = plainToInstance(NutritionalValuesDto, { ...validNutritionalValues, Calories: undefined });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'Calories')).toBe(true);
  });

  it('rechaza Protein negativo', async () => {
    const dto = plainToInstance(NutritionalValuesDto, { ...validNutritionalValues, Protein: -10 });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'Protein')).toBe(true);
  });

  it('rechaza Description vacío', async () => {
    const dto = plainToInstance(NutritionalValuesDto, { ...validNutritionalValues, Description: '' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'Description')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MealDto
// ---------------------------------------------------------------------------
describe('MealDto', () => {
  const validMeal = {
    mealType: MealType.LUNCH,
    title: 'Almuerzo',
    nutritionalValues: validNutritionalValues,
    recipe: validRecipe,
  };

  it('acepta una comida completa válida', async () => {
    const dto = plainToInstance(MealDto, validMeal);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza una comida sin recipe', async () => {
    const dto = plainToInstance(MealDto, { ...validMeal, recipe: undefined });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'recipe')).toBe(true);
  });

  it('rechaza una comida sin nutritionalValues', async () => {
    const dto = plainToInstance(MealDto, { ...validMeal, nutritionalValues: undefined });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'nutritionalValues')).toBe(true);
  });

  it('preserva title, ingredients e instructions al pasar por el DTO', async () => {
    const dto = plainToInstance(MealDto, validMeal);
    expect(dto.recipe?.title).toBe(validRecipe.title);
    expect(dto.recipe?.ingredients).toHaveLength(1);
    expect(dto.recipe?.instructions).toBe(validRecipe.instructions);
  });
});
