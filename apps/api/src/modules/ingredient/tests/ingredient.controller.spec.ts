import { BadRequestException } from '@nestjs/common';
import { IngredientController } from '../ingredient.controller';
import { IngredientService } from '../ingredient.service';
import { IngredientType } from '@/generated/prisma/client';

describe('IngredientController', () => {
  let controller: IngredientController;
  let service: jest.Mocked<IngredientService>;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<IngredientService>;

    controller = new IngredientController(service);
  });

  describe('create', () => {
    const validBaseDto = {
      name: 'Sal',
      type: IngredientType.OTHER,
      nutritionalValues: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      properties: ['Vegano'],
    };

    it('rejects empty string for description with BadRequestException', async () => {
      await expect(
        controller.create({ ...validBaseDto, description: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects whitespace-only string for description with BadRequestException', async () => {
      await expect(
        controller.create({ ...validBaseDto, description: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects empty string for defaultUnit with BadRequestException', async () => {
      await expect(
        controller.create({ ...validBaseDto, defaultUnit: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects whitespace-only string for defaultUnit with BadRequestException', async () => {
      await expect(
        controller.create({ ...validBaseDto, defaultUnit: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('successfully calls service.create when optional strings are valid', async () => {
      const dto = {
        ...validBaseDto,
        description: 'Sal marina natural',
        defaultUnit: 'g',
      };
      (service.create as jest.Mock).mockResolvedValue({ id: '1', ...dto });

      const result = await controller.create(dto);
      expect(service.create).toHaveBeenCalledWith(dto);
      expect(result).toBeDefined();
    });

    it('successfully calls service.create when optional strings are omitted (undefined)', async () => {
      (service.create as jest.Mock).mockResolvedValue({ id: '1', ...validBaseDto });

      const result = await controller.create(validBaseDto);
      expect(service.create).toHaveBeenCalledWith(validBaseDto);
      expect(result).toBeDefined();
    });
  });

  describe('update', () => {
    it('rejects empty string for description with BadRequestException', async () => {
      await expect(
        controller.update('id-1', { description: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects whitespace-only string for description with BadRequestException', async () => {
      await expect(
        controller.update('id-1', { description: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects empty string for defaultUnit with BadRequestException', async () => {
      await expect(
        controller.update('id-1', { defaultUnit: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects whitespace-only string for defaultUnit with BadRequestException', async () => {
      await expect(
        controller.update('id-1', { defaultUnit: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('successfully calls service.update when optional strings are valid', async () => {
      const updateDto = { description: 'Nueva descripción', defaultUnit: 'kg' };
      (service.update as jest.Mock).mockResolvedValue({ id: 'id-1', ...updateDto });

      const result = await controller.update('id-1', updateDto);
      expect(service.update).toHaveBeenCalledWith('id-1', updateDto);
      expect(result).toBeDefined();
    });
  });
});
