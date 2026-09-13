import { Test, TestingModule } from '@nestjs/testing';
import { RecipeService } from '../recipe.service';
import { RecipeRepository } from '../recipe.repository';
import { NotFoundException } from '@nestjs/common';

const mockRecipeRepository = {
  create: jest.fn(),
  findAll: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

describe('RecipeService', () => {
  let service: RecipeService;
  let repository: typeof mockRecipeRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecipeService,
        {
          provide: RecipeRepository,
          useValue: mockRecipeRepository,
        },
      ],
    }).compile();

    service = module.get<RecipeService>(RecipeService);
    repository = module.get(RecipeRepository);

    jest.clearAllMocks();
  });

  describe('findById', () => {
    it('should return recipe if found', async () => {
      const recipe = { id: '1', title: 'Receta Test' };
      repository.findById.mockResolvedValue(recipe);
      
      const result = await service.findById('1');
      expect(result).toEqual(recipe);
    });

    it('should throw NotFoundException if not found', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.findById('1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create recipe', async () => {
      const dto = { title: 'Receta Test', prepMinutes: 10, cookMinutes: 20, description: 'Test', ingredients: [], instructions: [] };
      repository.create.mockResolvedValue({ id: '1', ...dto });

      const result = await service.create(dto as any);
      expect(result.id).toBe('1');
      expect(repository.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('update', () => {
    it('should update successfully if exists', async () => {
      const recipe = { id: '1', title: 'Vieja' };
      const dto = { title: 'Nueva' };
      repository.findById.mockResolvedValue(recipe);
      repository.update.mockResolvedValue({ ...recipe, ...dto });

      const result = await service.update('1', dto);
      expect(result.title).toBe('Nueva');
      expect(repository.update).toHaveBeenCalledWith('1', dto);
    });
  });

  describe('delete', () => {
    it('should delete successfully if exists', async () => {
      repository.findById.mockResolvedValue({ id: '1', title: 'Receta Test' });
      repository.delete.mockResolvedValue({ id: '1' });

      const result = await service.delete('1');
      expect(result.id).toBe('1');
      expect(repository.delete).toHaveBeenCalledWith('1');
    });

    it('should throw NotFoundException when deleting non-existing recipe', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.delete('1')).rejects.toThrow(NotFoundException);
    });
  });
});
