import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { CreateRecipeDto } from '../dto/create-recipe.dto';

describe('CreateRecipeDto Transformation', () => {
  it('should normalize properties array (trim, deduplicate, case-insensitive)', () => {
    const plain = {
      title: 'Test',
      description: 'Test desc',
      prepMinutes: 10,
      cookMinutes: 20,
      categories: ['VEGAN'],
      ingredients: [{ name: 'Tomato', quantity: 1, unit: 'kg' }],
      instructions: ['Cut tomato'],
      nutritionalValues: { calories: 100, protein: 2, carbs: 5, fat: 0 },
      properties: [' Sin Gluten ', 'Alto en Fibra', 'sin gluten', '  ', 'ALTO EN FIBRA']
    };

    const instance = plainToInstance(CreateRecipeDto, plain);

    expect(instance.properties).toEqual(['Sin Gluten', 'Alto en Fibra']);
  });

  it('should handle undefined properties or empty array', () => {
    const plain = {
      title: 'Test',
      properties: []
    };

    const instance = plainToInstance(CreateRecipeDto, plain);
    expect(instance.properties).toEqual([]);
  });
});
