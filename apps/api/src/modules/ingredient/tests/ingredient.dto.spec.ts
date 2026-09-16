import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateIngredientDto, IngredientNutritionalValuesDto } from '../dto/create-ingredient.dto';
import { UpdateIngredientDto } from '../dto/update-ingredient.dto';
import { IngredientType } from '@/generated/prisma/client';

describe('Ingredient DTOs', () => {
  describe('CreateIngredientDto Transformation', () => {
    it('should normalize properties array (trim, deduplicate, case-insensitive)', () => {
      const plain = {
        name: 'Sal',
        type: 'OTHER',
        description: 'Sal marina',
        defaultUnit: 'g',
        nutritionalValues: { calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 39000 },
        properties: [' Vegano ', 'Libre de sodio', 'vegano', '  ', 'LIBRE DE SODIO']
      };

      const instance = plainToInstance(CreateIngredientDto, plain);

      expect(instance.properties).toEqual(['Vegano', 'Libre de sodio']);
    });
  });

  describe('IngredientNutritionalValuesDto Validation', () => {
    const baseNutritionalValues = {
      calories: 100,
      protein: 10,
      carbs: 20,
      fat: 5,
    };

    it('accepts valid nutritional values with omitted fiber and sodium', async () => {
      const dto = plainToInstance(IngredientNutritionalValuesDto, baseNutritionalValues);
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts valid non-negative numbers for fiber and sodium', async () => {
      const dto = plainToInstance(IngredientNutritionalValuesDto, {
        ...baseNutritionalValues,
        fiber: 2.5,
        sodium: 120,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects null for fiber', async () => {
      const dto = plainToInstance(IngredientNutritionalValuesDto, {
        ...baseNutritionalValues,
        fiber: null,
      });
      const errors = await validate(dto);
      expect(errors.some(e => e.property === 'fiber')).toBe(true);
    });

    it('rejects null for sodium', async () => {
      const dto = plainToInstance(IngredientNutritionalValuesDto, {
        ...baseNutritionalValues,
        sodium: null,
      });
      const errors = await validate(dto);
      expect(errors.some(e => e.property === 'sodium')).toBe(true);
    });

    it('rejects negative numbers for fiber and sodium', async () => {
      const dto = plainToInstance(IngredientNutritionalValuesDto, {
        ...baseNutritionalValues,
        fiber: -1,
        sodium: -10,
      });
      const errors = await validate(dto);
      expect(errors.some(e => e.property === 'fiber')).toBe(true);
      expect(errors.some(e => e.property === 'sodium')).toBe(true);
    });
  });

  describe('UpdateIngredientDto Validation', () => {
    it('accepts an empty update object (omitted fields)', async () => {
      const dto = plainToInstance(UpdateIngredientDto, {});
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts valid partial update fields', async () => {
      const dto = plainToInstance(UpdateIngredientDto, {
        name: 'Pollo Actualizado',
        type: IngredientType.MEAT,
        description: 'Nueva descripción',
        defaultUnit: 'kg',
        properties: ['Alto en Proteína'],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects null for name', async () => {
      const dto = plainToInstance(UpdateIngredientDto, { name: null });
      const errors = await validate(dto);
      expect(errors.some(e => e.property === 'name')).toBe(true);
    });

    it('rejects null for type', async () => {
      const dto = plainToInstance(UpdateIngredientDto, { type: null });
      const errors = await validate(dto);
      expect(errors.some(e => e.property === 'type')).toBe(true);
    });

    it('rejects null for nutritionalValues', async () => {
      const dto = plainToInstance(UpdateIngredientDto, { nutritionalValues: null });
      const errors = await validate(dto);
      expect(errors.some(e => e.property === 'nutritionalValues')).toBe(true);
    });

    it('rejects null for properties', async () => {
      const dto = plainToInstance(UpdateIngredientDto, { properties: null });
      const errors = await validate(dto);
      expect(errors.some(e => e.property === 'properties')).toBe(true);
    });

    it('rejects null inside nutritionalValues for update', async () => {
      const dto = plainToInstance(UpdateIngredientDto, {
        nutritionalValues: {
          calories: 100,
          protein: 5,
          carbs: 10,
          fat: 2,
          fiber: null,
        },
      });
      const errors = await validate(dto);
      expect(errors.some(e => e.property === 'nutritionalValues')).toBe(true);
    });
  });
});

