import { Test, TestingModule } from '@nestjs/testing';
import { IngredientService } from '../ingredient.service';
import { IngredientRepository } from '../ingredient.repository';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { IngredientType } from '@/generated/prisma/client';

const mockIngredientRepository = {
  create: jest.fn(),
  findAll: jest.fn(),
  findById: jest.fn(),
  findByName: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  isIngredientInUse: jest.fn(),
};

describe('IngredientService', () => {
  let service: IngredientService;
  let repository: typeof mockIngredientRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngredientService,
        {
          provide: IngredientRepository,
          useValue: mockIngredientRepository,
        },
      ],
    }).compile();

    service = module.get<IngredientService>(IngredientService);
    repository = module.get(IngredientRepository);

    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should successfully create an ingredient', async () => {
      const dto = { name: 'Pollo', type: IngredientType.MEAT, nutritionalValues: { calories: 100, protein: 20, carbs: 0, fat: 2 } };
      repository.findByName.mockResolvedValue(null);
      repository.create.mockResolvedValue({ id: '1', ...dto });

      const result = await service.create(dto);
      expect(result).toEqual({ id: '1', ...dto });
      expect(repository.create).toHaveBeenCalledWith(dto);
    });

    it('should throw ConflictException if ingredient name already exists', async () => {
      const dto = { name: 'Pollo', type: IngredientType.MEAT, nutritionalValues: { calories: 100, protein: 20, carbs: 0, fat: 2 } };
      repository.findByName.mockResolvedValue({ id: '1', name: 'Pollo' });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('should update successfully', async () => {
      const existing = { id: '1', name: 'Pollo' };
      const dto = { name: 'Pollo Editado' };
      repository.findById.mockResolvedValue(existing);
      repository.findByName.mockResolvedValue(null);
      repository.update.mockResolvedValue({ ...existing, ...dto });

      const result = await service.update('1', dto);
      expect(result.name).toBe('Pollo Editado');
      expect(repository.update).toHaveBeenCalledWith('1', dto);
    });

    it('should throw ConflictException if renaming to an existing ingredient', async () => {
      const existing = { id: '1', name: 'Pollo' };
      const dto = { name: 'Carne' };
      repository.findById.mockResolvedValue(existing);
      repository.findByName.mockResolvedValue({ id: '2', name: 'Carne' });

      await expect(service.update('1', dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('delete', () => {
    it('should throw ConflictException if ingredient is used in recipes', async () => {
      repository.findById.mockResolvedValue({ id: '1', name: 'Pollo' });
      repository.isIngredientInUse.mockResolvedValue(true);

      await expect(service.delete('1')).rejects.toThrow(ConflictException);
    });

    it('should delete if not in use', async () => {
      repository.findById.mockResolvedValue({ id: '1', name: 'Pollo' });
      repository.isIngredientInUse.mockResolvedValue(false);
      repository.delete.mockResolvedValue({ id: '1', name: 'Pollo' });

      const result = await service.delete('1');
      expect(result.id).toBe('1');
      expect(repository.delete).toHaveBeenCalledWith('1');
    });
  });
});
