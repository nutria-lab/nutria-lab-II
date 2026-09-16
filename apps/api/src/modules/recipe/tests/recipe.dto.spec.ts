import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateRecipeDto } from '../dto/create-recipe.dto';
import { UpdateRecipeDto } from '../dto/update-recipe.dto';
import { RecipeCategory } from '@/generated/prisma/client';

describe('Recipe DTOs', () => {
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

  describe('UpdateRecipeDto Validation', () => {
    it('accepts an empty update object (omitted fields)', async () => {
      const dto = plainToInstance(UpdateRecipeDto, {});
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts valid partial update fields', async () => {
      const dto = plainToInstance(UpdateRecipeDto, {
        title: 'Nueva Receta',
        categories: [RecipeCategory.VEGAN],
        nutritionalValues: { calories: 300, protein: 20, carbs: 40, fat: 5 },
        properties: ['Vegano'],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects null for categories', async () => {
      const dto = plainToInstance(UpdateRecipeDto, { categories: null });
      const errors = await validate(dto);
      expect(errors.some(e => e.property === 'categories')).toBe(true);
    });

    it('rejects null for properties', async () => {
      const dto = plainToInstance(UpdateRecipeDto, { properties: null });
      const errors = await validate(dto);
      expect(errors.some(e => e.property === 'properties')).toBe(true);
    });

    it('rejects null for nutritionalValues', async () => {
      const dto = plainToInstance(UpdateRecipeDto, { nutritionalValues: null });
      const errors = await validate(dto);
      expect(errors.some(e => e.property === 'nutritionalValues')).toBe(true);
    });

    it('rejects null for ingredients', async () => {
      const dto = plainToInstance(UpdateRecipeDto, { ingredients: null });
      const errors = await validate(dto);
      expect(errors.some(e => e.property === 'ingredients')).toBe(true);
    });

    it('rejects null for instructions', async () => {
      const dto = plainToInstance(UpdateRecipeDto, { instructions: null });
      const errors = await validate(dto);
      expect(errors.some(e => e.property === 'instructions')).toBe(true);
    });
  });
});

