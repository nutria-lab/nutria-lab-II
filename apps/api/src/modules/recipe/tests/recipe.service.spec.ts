import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RecipeService } from '../recipe.service';
import { RecipeRepository } from '../recipe.repository';
import { UnsplashService } from '@/modules/unsplash/unsplash.service';
import {
  pendingPersistedImage,
  unsplashPhoto,
  unsplashResponse,
  unsplashSearchBody,
} from '@/modules/unsplash/unsplash-search.fixture';

interface RecipeListCriteria {
  q?: string;
  properties?: string;
  maxPrepMinutes?: number;
  page?: number;
  pageSize?: number;
}

type FindAllWithCriteria = (criteria: RecipeListCriteria) => Promise<unknown>;

const PUBLIC_IMAGE_KEYS = ['alt', 'imageUrl', 'photographer', 'photographerUrl', 'provider', 'providerPhotoId', 'query', 'retrievedAt', 'sourceUrl'].sort();

const recipeDto = {
  title: 'Ensalada de Quinoa',
  prepMinutes: 10,
  cookMinutes: 20,
  description: 'Test',
  ingredients: [],
  instructions: [],
  categories: [],
  properties: [],
  nutritionalValues: { calories: 1, protein: 1, carbs: 1, fat: 1 },
};

function createRepositoryMock() {
  return {
    create: jest.fn(async (data: any) => ({ id: 'recipe-1', ...data })),
    findAll: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    updateImage: jest.fn(async (id: string, image: unknown) => ({ id, image })),
    delete: jest.fn(),
  };
}

function createUnsplashMock() {
  return {
    searchAndSelectCandidate: jest.fn(),
    trackDownload: jest.fn(async (image: any) => ({
      ...image,
      tracking: { ...image.tracking, status: 'SUCCEEDED', lastAttemptAt: '2026-10-03T12:00:05.000Z' },
    })),
  };
}

describe('RecipeService', () => {
  let service: RecipeService;
  let repository: ReturnType<typeof createRepositoryMock>;
  let unsplash: ReturnType<typeof createUnsplashMock>;

  beforeEach(async () => {
    repository = createRepositoryMock();
    unsplash = createUnsplashMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecipeService,
        { provide: RecipeRepository, useValue: repository },
        { provide: UnsplashService, useValue: unsplash },
      ],
    }).compile();

    service = module.get<RecipeService>(RecipeService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  describe('create (POST /recipes)', () => {
    it('searches by title before saving, and saves the image with tracking PENDING', async () => {
      const pending = pendingPersistedImage();
      const callOrder: string[] = [];
      unsplash.searchAndSelectCandidate.mockImplementation(async (title: string) => {
        callOrder.push(`search:${title}`);
        return pending;
      });
      repository.create.mockImplementation(async (data: any) => {
        callOrder.push(`create:tracking=${data.image.tracking.status}`);
        return { id: 'recipe-1', ...data };
      });

      await service.create(recipeDto as any);

      expect(callOrder.slice(0, 2)).toEqual(['search:Ensalada de Quinoa', 'create:tracking=PENDING']);
      expect(repository.create).toHaveBeenCalledWith({ ...recipeDto, image: pending });
    });

    it('sends the usage event only after the recipe is saved, then writes the tracking result back', async () => {
      const pending = pendingPersistedImage();
      const callOrder: string[] = [];
      unsplash.searchAndSelectCandidate.mockResolvedValue(pending);
      repository.create.mockImplementation(async (data: any) => {
        callOrder.push('create');
        return { id: 'recipe-1', ...data };
      });
      unsplash.trackDownload.mockImplementation(async (image: any) => {
        callOrder.push('trackDownload');
        return { ...image, tracking: { ...image.tracking, status: 'SUCCEEDED', lastAttemptAt: '2026-10-03T12:00:05.000Z' } };
      });
      repository.updateImage.mockImplementation(async (id: string, image: any) => {
        callOrder.push(`updateImage:${id}:${image.tracking.status}`);
        return { id, image };
      });

      await service.create(recipeDto as any);

      expect(callOrder).toEqual(['create', 'trackDownload', 'updateImage:recipe-1:SUCCEEDED']);
      expect(unsplash.trackDownload).toHaveBeenCalledWith(pending);
    });

    it('returns only the 9 public image fields, never the tracking metadata', async () => {
      unsplash.searchAndSelectCandidate.mockResolvedValue(pendingPersistedImage());

      const result: any = await service.create(recipeDto as any);

      expect(Object.keys(result.image).sort()).toEqual(PUBLIC_IMAGE_KEYS);
      expect(JSON.stringify(result)).not.toContain('/download');
    });

    it('a failed tracking keeps the recipe and its image, and stores FAILED for recovery', async () => {
      const pending = pendingPersistedImage();
      unsplash.searchAndSelectCandidate.mockResolvedValue(pending);
      unsplash.trackDownload.mockImplementation(async (image: any) => ({
        ...image,
        tracking: { ...image.tracking, status: 'FAILED', lastAttemptAt: '2026-10-03T12:00:05.000Z' },
      }));

      const result: any = await service.create(recipeDto as any);

      expect(result.id).toBe('recipe-1');
      expect(result.image.imageUrl).toBe(pending.imageUrl);
      expect(repository.updateImage).toHaveBeenCalledWith('recipe-1', expect.objectContaining({ tracking: expect.objectContaining({ status: 'FAILED' }) }));
    });

    it('if writing the tracking result fails, the recipe is still returned with its image and a warning is logged', async () => {
      unsplash.searchAndSelectCandidate.mockResolvedValue(pendingPersistedImage());
      repository.updateImage.mockRejectedValue(new Error('connection reset'));
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const result: any = await service.create(recipeDto as any);

      expect(result.id).toBe('recipe-1');
      expect(result.image).not.toBeNull();
      expect(String(warnSpy.mock.calls[0][0])).toContain('stays PENDING for recovery');
    });

    it('with no image found, saves image: null and never tracks', async () => {
      unsplash.searchAndSelectCandidate.mockResolvedValue(null);

      const result: any = await service.create(recipeDto as any);

      expect(repository.create).toHaveBeenCalledWith({ ...recipeDto, image: null });
      expect(unsplash.trackDownload).not.toHaveBeenCalled();
      expect(repository.updateImage).not.toHaveBeenCalled();
      expect(result.image).toBeNull();
    });

    it('an unexpected search rejection degrades to image: null instead of failing the creation', async () => {
      unsplash.searchAndSelectCandidate.mockRejectedValue(new TypeError('bug inesperado'));
      jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const result: any = await service.create(recipeDto as any);

      expect(repository.create).toHaveBeenCalledWith({ ...recipeDto, image: null });
      expect(result.id).toBe('recipe-1');
    });

    it('if saving the recipe fails, no usage event is sent', async () => {
      unsplash.searchAndSelectCandidate.mockResolvedValue(pendingPersistedImage());
      repository.create.mockRejectedValue(new Error('unique constraint'));

      await expect(service.create(recipeDto as any)).rejects.toThrow('unique constraint');
      expect(unsplash.trackDownload).not.toHaveBeenCalled();
    });
  });

  describe('reads, PATCH and DELETE never expose tracking metadata', () => {
    const persisted = pendingPersistedImage({ tracking: { status: 'SUCCEEDED', lastAttemptAt: '2026-10-03T12:00:05.000Z' } });

    it('findAll: each item.image only has the 9 public fields', async () => {
      repository.findAll.mockResolvedValue({ items: [{ id: 'recipe-1', title: 'Ensalada', image: persisted }], page: 1, pageSize: 12, total: 1 });

      const result: any = await (service.findAll as unknown as FindAllWithCriteria)({});

      expect(Object.keys(result.items[0].image).sort()).toEqual(PUBLIC_IMAGE_KEYS);
    });

    it('findById: image only has the 9 public fields', async () => {
      repository.findById.mockResolvedValue({ id: 'recipe-1', title: 'Ensalada', image: persisted });

      const result: any = await service.findById('recipe-1');

      expect(Object.keys(result.image).sort()).toEqual(PUBLIC_IMAGE_KEYS);
    });

    it('update (PATCH): never writes the image and returns it without tracking metadata', async () => {
      repository.findById.mockResolvedValue({ id: 'recipe-1', title: 'Vieja', image: persisted });
      repository.update.mockResolvedValue({ id: 'recipe-1', title: 'Nueva', image: persisted });

      const result: any = await service.update('recipe-1', { title: 'Nueva' });

      expect(repository.update).toHaveBeenCalledWith('recipe-1', { title: 'Nueva' });
      expect(result.title).toBe('Nueva');
      expect(Object.keys(result.image).sort()).toEqual(PUBLIC_IMAGE_KEYS);
    });

    it('delete: returns the deleted recipe without tracking metadata', async () => {
      repository.findById.mockResolvedValue({ id: 'recipe-1', image: persisted });
      repository.delete.mockResolvedValue({ id: 'recipe-1', image: persisted });

      const result: any = await service.delete('recipe-1');

      expect(repository.delete).toHaveBeenCalledWith('recipe-1');
      expect(Object.keys(result.image).sort()).toEqual(PUBLIC_IMAGE_KEYS);
    });

    it('should throw NotFoundException when deleting non-existing recipe', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.delete('1')).rejects.toThrow(NotFoundException);
    });
  });
});

describe('RecipeService + real UnsplashService', () => {
  const MOCK_API_KEY = 'test-unsplash-key-recipe-integration';
  const originalFetch = global.fetch;

  function setup() {
    const events: string[] = [];
    const photo = unsplashPhoto();
    const fetchMock = jest.fn(async (url: unknown) => {
      const target = String(url);
      if (target.startsWith('https://api.unsplash.com/search/photos')) {
        events.push('fetch:search');
        return unsplashResponse(unsplashSearchBody([photo]), { remaining: 49 });
      }
      if (target === photo.links.download_location) {
        events.push('fetch:download_location');
        return unsplashResponse({ url: photo.urls.raw });
      }
      throw new Error(`unexpected fetch: ${target}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    let stored: any = null;
    const repository = createRepositoryMock();
    repository.create.mockImplementation(async (data: any) => {
      events.push('db:create');
      stored = { id: 'recipe-1', ...data };
      return stored;
    });
    repository.updateImage.mockImplementation(async (id: string, image: any) => {
      events.push(`db:updateImage:${image.tracking.status}`);
      stored = { ...stored, image };
      return stored;
    });
    repository.findById.mockImplementation(async () => stored);

    const configService = { get: jest.fn((key: string) => (key === 'UNSPLASH_ACCESS_KEY' ? MOCK_API_KEY : undefined)) } as unknown as ConfigService;
    const service = new RecipeService(repository as any, new UnsplashService(configService));
    return { service, events, fetchMock, photo, getStored: () => stored };
  }

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('searches, saves PENDING, then sends the usage event and stores SUCCEEDED - in that order', async () => {
    const { service, events, getStored, photo } = setup();

    const result: any = await service.create(recipeDto as any);

    expect(events).toEqual(['fetch:search', 'db:create', 'fetch:download_location', 'db:updateImage:SUCCEEDED']);
    expect(getStored().image.tracking).toEqual({ status: 'SUCCEEDED', lastAttemptAt: expect.any(String), trackingUrl: photo.links.download_location });
    expect(result.image.imageUrl).toBe(photo.urls.regular);
    expect(result.image.photographerUrl).toBe('https://unsplash.com/@anna_pelzer?utm_source=nutria&utm_medium=referral');
  });

  it('GET /recipes/:id returns the same persisted image on every read with no external call and no tracking metadata', async () => {
    const { service, fetchMock } = setup();
    const created: any = await service.create(recipeDto as any);
    fetchMock.mockClear();

    const firstRead: any = await service.findById('recipe-1');
    const secondRead: any = await service.findById('recipe-1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(firstRead.image).toEqual(created.image);
    expect(secondRead.image).toEqual(created.image);
    expect(JSON.stringify(firstRead)).not.toContain('tracking');
    expect(JSON.stringify(firstRead)).not.toContain(MOCK_API_KEY);
  });

  it('an existing recipe with image: null stays null on read and triggers no search', async () => {
    const { service, fetchMock } = setup();
    const repositoryFindById = (service as any).repository.findById as jest.Mock;
    repositoryFindById.mockResolvedValue({ id: 'legacy-1', title: 'Receta vieja', image: null });

    const result: any = await service.findById('legacy-1');

    expect(result.image).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('if saving the recipe fails, neither the usage event nor any DB update happens', async () => {
    const { service, events } = setup();
    ((service as any).repository.create as jest.Mock).mockRejectedValue(new Error('db down'));

    await expect(service.create(recipeDto as any)).rejects.toThrow('db down');

    expect(events).toEqual(['fetch:search']);
  });
});
