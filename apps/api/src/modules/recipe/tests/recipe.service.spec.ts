import { Test, TestingModule } from '@nestjs/testing';
import { RecipeService } from '../recipe.service';
import { RecipeRepository } from '../recipe.repository';
import { UnsplashService } from '@/modules/unsplash/unsplash.service';
import { NotFoundException } from '@nestjs/common';

interface RecipeListCriteria {
  q?: string;
  properties?: string;
  maxPrepMinutes?: number;
  page?: number;
  pageSize?: number;
}

type FindAllWithCriteria = (criteria: RecipeListCriteria) => Promise<unknown>;

const mockRecipeRepository = {
  create: jest.fn(),
  findAll: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

// Mocked by constructor (same mechanism already used below for RecipeRepository): Nest skips
// injecting a provider the class under test doesn't declare yet, so this registration is a
// no-op pre-implementation and resolves for real once RecipeService takes `unsplash` (NUT-83,
// design.md D1/D2).
const mockUnsplashService = {
  resolveImage: jest.fn(),
  // Ciclo B (design.md 12.5.2 paso 3, plan.md 12.2.1): post-persistence tracking. Default
  // implementation just marks it SUCCEEDED so pre-existing tests that don't care about tracking
  // keep working without their own mock.
  trackDownload: jest.fn(async (image: any) => ({
    ...image,
    tracking: { ...(image?.tracking ?? {}), status: 'SUCCEEDED', lastAttemptAt: new Date().toISOString() },
  })),
};

describe('RecipeService', () => {
  let service: RecipeService;
  let repository: typeof mockRecipeRepository;
  let unsplash: typeof mockUnsplashService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecipeService,
        {
          provide: RecipeRepository,
          useValue: mockRecipeRepository,
        },
        {
          provide: UnsplashService,
          useValue: mockUnsplashService,
        },
      ],
    }).compile();

    service = module.get<RecipeService>(RecipeService);
    repository = module.get(RecipeRepository);
    unsplash = module.get(UnsplashService);

    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('normalizes the combined search criteria before querying once and preserves returned recipe properties', async () => {
      const criteria: RecipeListCriteria = {
        q: '  Avena con Ñuez  ',
        properties: ' Sin Gluten,Alto en Fibra,sin gluten ',
        maxPrepMinutes: 30,
        page: 2,
        pageSize: 8,
      };
      const page = {
        items: [{ id: 'recipe-1', properties: ['Sin Gluten', 'Alto en Fibra'], image: null }],
        page: 2,
        pageSize: 8,
        total: 9,
      };
      repository.findAll.mockResolvedValue(page);

      const result = await (service.findAll as unknown as FindAllWithCriteria)(criteria);

      expect(repository.findAll).toHaveBeenCalledTimes(1);
      expect(repository.findAll).toHaveBeenCalledWith({
        q: 'Avena con Ñuez',
        properties: ['Sin Gluten', 'Alto en Fibra'],
        maxPrepMinutes: 30,
        page: 2,
        pageSize: 8,
      });
      expect(result).toEqual(page);
      expect((result as { items: Array<{ properties: string[] }> }).items[0].properties).toEqual([
        'Sin Gluten',
        'Alto en Fibra',
      ]);
    });

    it('uses the required defaults when no filters are supplied', async () => {
      const page = { items: [], page: 1, pageSize: 12, total: 0 };
      repository.findAll.mockResolvedValue(page);

      await (service.findAll as unknown as FindAllWithCriteria)({});

      expect(repository.findAll).toHaveBeenCalledWith({ page: 1, pageSize: 12 });
    });
  });

  describe('findById', () => {
    it('should return recipe if found', async () => {
      const recipe = { id: '1', title: 'Receta Test', image: null };
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
      const dto = { title: 'Receta Test', prepMinutes: 10, cookMinutes: 20, description: 'Test', ingredients: [], instructions: [], categories: [], properties: [], nutritionalValues: { calories: 1, protein: 1, carbs: 1, fat: 1 } };
      repository.create.mockResolvedValue({ id: '1', ...dto });

      const result = await service.create(dto as any);
      expect(result.id).toBe('1');
      expect(repository.create).toHaveBeenCalledWith(dto);
    });

    // POST /recipes has no transaction of its own (RecipeRepository.create is a single
    // prisma.recipe.create, plan.md 10.2), so D2 is satisfied simply by resolving `image`
    // before building the object passed to repository.create.
    it('AC13/AC14 (NUT-83): invoca unsplash.resolveImage(data.title) ANTES de repository.create', async () => {
      const dto = { title: 'Ensalada de Quinoa', prepMinutes: 10, cookMinutes: 20, description: 'Test', ingredients: [], instructions: [], categories: [], properties: [], nutritionalValues: { calories: 1, protein: 1, carbs: 1, fat: 1 } };
      const resolvedImage = {
        provider: 'UNSPLASH',
        providerPhotoId: '12345',
        imageUrl: 'https://images.unsplash.com/photo-12345?w=1080',
        sourceUrl: 'https://unsplash.com/photos/12345',
        photographer: 'Jane Doe',
        photographerUrl: 'https://unsplash.com/@janedoe',
        alt: 'A bowl of quinoa salad',
        query: 'ensalada de quinoa food recipe',
        retrievedAt: '2026-09-30T12:00:00.000Z',
      };
      const callOrder: string[] = [];

      unsplash.resolveImage.mockImplementation(async (title: string) => {
        callOrder.push(`resolveImage:${title}`);
        return resolvedImage;
      });
      repository.create.mockImplementation(async (data: any) => {
        callOrder.push('repository.create');
        return { id: '1', ...data };
      });

      await service.create(dto as any);

      expect(callOrder).toEqual(['resolveImage:Ensalada de Quinoa', 'repository.create']);
      expect(unsplash.resolveImage).toHaveBeenCalledWith(dto.title);
    });

    it('AC3 (NUT-83): el objeto pasado a repository.create incluye el RecipeImage resuelto bajo la clave "image"', async () => {
      const dto = { title: 'Ensalada de Quinoa', prepMinutes: 10, cookMinutes: 20, description: 'Test', ingredients: [], instructions: [], categories: [], properties: [], nutritionalValues: { calories: 1, protein: 1, carbs: 1, fat: 1 } };
      const resolvedImage = {
        provider: 'UNSPLASH',
        providerPhotoId: '12345',
        imageUrl: 'https://images.unsplash.com/photo-12345?w=1080',
        sourceUrl: 'https://unsplash.com/photos/12345',
        photographer: 'Jane Doe',
        photographerUrl: 'https://unsplash.com/@janedoe',
        alt: 'A bowl of quinoa salad',
        query: 'ensalada de quinoa food recipe',
        retrievedAt: '2026-09-30T12:00:00.000Z',
      };

      unsplash.resolveImage.mockResolvedValue(resolvedImage);
      repository.create.mockResolvedValue({ id: '1', ...dto, image: resolvedImage });

      await service.create(dto as any);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ ...dto, image: resolvedImage }),
      );
    });

    it('AC4/AC5 (NUT-83): cuando unsplash.resolveImage devuelve null (sin resultados o proveedor no disponible), repository.create se llama igual con image: null y create completa exitosamente', async () => {
      const dto = { title: 'Ensalada de Quinoa', prepMinutes: 10, cookMinutes: 20, description: 'Test', ingredients: [], instructions: [], categories: [], properties: [], nutritionalValues: { calories: 1, protein: 1, carbs: 1, fat: 1 } };

      unsplash.resolveImage.mockResolvedValue(null);
      repository.create.mockResolvedValue({ id: '1', ...dto, image: null });

      const result = await service.create(dto as any);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ ...dto, image: null }),
      );
      expect(result.id).toBe('1');
    });

    // Gap 2 (BLOQUEANTE): unlike the documented null-return paths above (design.md section 4),
    // an unexpected rejection from resolveImage must not propagate and break create() — D4/
    // Flujo B require the recipe to persist regardless of a provider failure.
    it('Gap 2 (NUT-83, BLOQUEANTE): cuando unsplash.resolveImage RECHAZA con una excepción inesperada (bug, no un null documentado), create NO propaga la excepción — completa exitosamente llamando a repository.create con image: null', async () => {
      const dto = { title: 'Ensalada de Quinoa', prepMinutes: 10, cookMinutes: 20, description: 'Test', ingredients: [], instructions: [], categories: [], properties: [], nutritionalValues: { calories: 1, protein: 1, carbs: 1, fat: 1 } };

      unsplash.resolveImage.mockRejectedValue(new TypeError('bug inesperado'));
      repository.create.mockResolvedValue({ id: '1', ...dto, image: null });

      const result = await service.create(dto as any);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ ...dto, image: null }),
      );
      expect(result.id).toBe('1');
    });

    // Ciclo B (design.md 12.5.2 paso 3, plan.md 12.2.1): persist first (tracking PENDING), only
    // then invoke tracking - never the other way around. `unsplash.resolveImage` now resolves
    // the full persisted shape (public fields + tracking), not just the 9-field public image.
    const pendingImage = {
      provider: 'UNSPLASH',
      providerPhotoId: '12345',
      imageUrl: 'https://images.unsplash.com/photo-12345?w=1080',
      sourceUrl: 'https://unsplash.com/photos/12345?utm_source=nutria&utm_medium=referral',
      photographer: 'Jane Doe',
      photographerUrl: 'https://unsplash.com/@janedoe?utm_source=nutria&utm_medium=referral',
      alt: 'A bowl of quinoa salad',
      query: 'ensalada de quinoa food recipe',
      retrievedAt: '2026-09-30T12:00:00.000Z',
      tracking: { status: 'PENDING', lastAttemptAt: null, trackingUrl: 'https://api.unsplash.com/photos/12345/download' },
    };
    const recipeDto = { title: 'Ensalada de Quinoa', prepMinutes: 10, cookMinutes: 20, description: 'Test', ingredients: [], instructions: [], categories: [], properties: [], nutritionalValues: { calories: 1, protein: 1, carbs: 1, fat: 1 } };

    it('ciclo B: persiste primero (con image.tracking.status PENDING) y recién después invoca unsplash.trackDownload', async () => {
      const callOrder: string[] = [];

      unsplash.resolveImage.mockResolvedValue(pendingImage);
      repository.create.mockImplementation(async (data: any) => {
        callOrder.push(`repository.create:tracking=${data.image?.tracking?.status}`);
        return { id: 'recipe-1', ...data };
      });
      (unsplash as any).trackDownload = jest.fn().mockImplementation(async (image: any) => {
        callOrder.push('trackDownload');
        return { ...image, tracking: { ...image.tracking, status: 'SUCCEEDED', lastAttemptAt: '2026-10-01T00:00:00.000Z' } };
      });

      await service.create(recipeDto as any);

      expect(callOrder).toEqual(['repository.create:tracking=PENDING', 'trackDownload']);
    });

    it('ciclo B: el objeto devuelto al caller (controller) nunca incluye la clave "tracking" dentro de image', async () => {
      unsplash.resolveImage.mockResolvedValue(pendingImage);
      repository.create.mockResolvedValue({ id: 'recipe-1', ...recipeDto, image: pendingImage });
      (unsplash as any).trackDownload = jest.fn().mockResolvedValue({
        ...pendingImage,
        tracking: { ...pendingImage.tracking, status: 'SUCCEEDED', lastAttemptAt: '2026-10-01T00:00:00.000Z' },
      });

      const result = await service.create(recipeDto as any);

      expect((result as any).image.tracking).toBeUndefined();
      expect(Object.keys((result as any).image).sort()).toEqual(
        ['alt', 'imageUrl', 'photographer', 'photographerUrl', 'provider', 'providerPhotoId', 'query', 'retrievedAt', 'sourceUrl'].sort(),
      );
    });

    it('ciclo B: cuando unsplash.resolveImage devuelve null, nunca invoca trackDownload y el image devuelto sigue siendo null', async () => {
      unsplash.resolveImage.mockResolvedValue(null);
      repository.create.mockResolvedValue({ id: 'recipe-1', ...recipeDto, image: null });
      (unsplash as any).trackDownload = jest.fn();

      const result = await service.create(recipeDto as any);

      expect((unsplash as any).trackDownload).not.toHaveBeenCalled();
      expect((result as any).image).toBeNull();
    });
  });

  // Ciclo B (design.md 12.5.1) - DTO filtering must happen in the service layer even though the
  // repository (findAll via $queryRaw, findById via findUnique) returns the raw persisted image.
  describe('NUT-83 ciclo B - filtrado de DTO público en findAll/findById', () => {
    const rawImage = {
      provider: 'UNSPLASH',
      providerPhotoId: '12345',
      imageUrl: 'https://images.unsplash.com/photo-12345?w=1080',
      sourceUrl: 'https://unsplash.com/photos/12345?utm_source=nutria&utm_medium=referral',
      photographer: 'Jane Doe',
      photographerUrl: 'https://unsplash.com/@janedoe?utm_source=nutria&utm_medium=referral',
      alt: 'A bowl of quinoa salad',
      query: 'ensalada de quinoa food recipe',
      retrievedAt: '2026-09-30T12:00:00.000Z',
      tracking: {
        status: 'SUCCEEDED',
        lastAttemptAt: '2026-09-30T12:05:00.000Z',
        trackingUrl: 'https://api.unsplash.com/photos/12345/download',
      },
    };

    it('findAll: cada item.image llega sin "tracking", aunque el repositorio devuelva el image crudo con tracking', async () => {
      const page = {
        items: [{ id: 'recipe-1', title: 'Ensalada de Quinoa', image: rawImage }],
        page: 1,
        pageSize: 12,
        total: 1,
      };
      repository.findAll.mockResolvedValue(page);

      const result: any = await (service.findAll as unknown as FindAllWithCriteria)({});

      expect(result.items[0].image.tracking).toBeUndefined();
      expect(Object.keys(result.items[0].image).sort()).toEqual(
        ['alt', 'imageUrl', 'photographer', 'photographerUrl', 'provider', 'providerPhotoId', 'query', 'retrievedAt', 'sourceUrl'].sort(),
      );
    });

    it('findById: el image devuelto llega sin "tracking", aunque el repositorio devuelva el image crudo con tracking', async () => {
      repository.findById.mockResolvedValue({ id: 'recipe-1', title: 'Ensalada de Quinoa', image: rawImage });

      const result: any = await service.findById('recipe-1');

      expect(result.image.tracking).toBeUndefined();
      expect(Object.keys(result.image).sort()).toEqual(
        ['alt', 'imageUrl', 'photographer', 'photographerUrl', 'provider', 'providerPhotoId', 'query', 'retrievedAt', 'sourceUrl'].sort(),
      );
    });

    it('findById: cuando image es null, sigue devolviendo image: null sin lanzar', async () => {
      repository.findById.mockResolvedValue({ id: 'recipe-1', title: 'Ensalada de Quinoa', image: null });

      const result: any = await service.findById('recipe-1');

      expect(result.image).toBeNull();
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
