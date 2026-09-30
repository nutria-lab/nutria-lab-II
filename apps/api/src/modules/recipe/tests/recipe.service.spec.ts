import { Test, TestingModule } from '@nestjs/testing';
import { RecipeService } from '../recipe.service';
import { RecipeRepository } from '../recipe.repository';
import { PexelsService } from '@/modules/pexels/pexels.service';
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

// NUT-83 (design.md D1 corregido/D2, plan.md sección 10.2): mock plano de PexelsService.
// A diferencia del patrón usado en `plans.service.spec.ts` (inyección por propiedad de
// instancia, `(service as any).pexels = mockPexels`, elegido ahí para no depender de que el
// constructor de `PlansService` ya tuviera el parámetro nuevo), acá se mockea por
// CONSTRUCTOR, registrando `PexelsService` como provider de `Test.createTestingModule`
// (`{ provide: PexelsService, useValue: mockPexelsService }`) — mismo mecanismo ya usado en
// este archivo para `RecipeRepository`. Nest simplemente no inyecta el provider si el
// constructor de `RecipeService` bajo test todavía no lo declara (estado actual, pre-
// implementación), así que este registro es inofensivo hoy y pasa a resolverse de verdad en
// cuanto el implementer agregue `pexels: PexelsService` al constructor de `RecipeService`
// (plan.md sección 10.2).
const mockPexelsService = {
  resolveImage: jest.fn(),
};

describe('RecipeService', () => {
  let service: RecipeService;
  let repository: typeof mockRecipeRepository;
  let pexels: typeof mockPexelsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecipeService,
        {
          provide: RecipeRepository,
          useValue: mockRecipeRepository,
        },
        {
          provide: PexelsService,
          useValue: mockPexelsService,
        },
      ],
    }).compile();

    service = module.get<RecipeService>(RecipeService);
    repository = module.get(RecipeRepository);
    pexels = module.get(PexelsService);

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
        items: [{ id: 'recipe-1', properties: ['Sin Gluten', 'Alto en Fibra'] }],
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
      const dto = { title: 'Receta Test', prepMinutes: 10, cookMinutes: 20, description: 'Test', ingredients: [], instructions: [], categories: [], properties: [], nutritionalValues: { calories: 1, protein: 1, carbs: 1, fat: 1 } };
      repository.create.mockResolvedValue({ id: '1', ...dto });

      const result = await service.create(dto as any);
      expect(result.id).toBe('1');
      expect(repository.create).toHaveBeenCalledWith(dto);
    });

    /**
     * NUT-83 (design.md D1 corregido/D2, plan.md sección 10.2) — `POST /recipes` (creación
     * manual individual) es, junto con la generación de plan por IA y la edición/regeneración
     * de plan, uno de los tres caminos de creación de receta a los que D1 corregido aplica: la
     * resolución de imagen se intenta para TODA receta nueva, sin importar `origin`. D2 exige
     * que la resolución ocurra fuera de cualquier transacción — acá no hay ninguna transacción
     * de por medio (`RecipeRepository.create` es un único `prisma.recipe.create`, plan.md
     * sección 10.2), así que D2 se satisface trivialmente con sólo resolver `image` ANTES de
     * construir el objeto que se pasa a `repository.create`.
     *
     * Estos tres tests deben fallar en rojo hasta que el implementer cambie
     * `RecipeService.create` para invocar `this.pexels.resolveImage(data.title)` antes de
     * `this.repository.create(...)`, y pase el resultado bajo la clave `image`.
     */
    it('AC13/AC14 (NUT-83): invoca pexels.resolveImage(data.title) ANTES de repository.create', async () => {
      const dto = { title: 'Ensalada de Quinoa', prepMinutes: 10, cookMinutes: 20, description: 'Test', ingredients: [], instructions: [], categories: [], properties: [], nutritionalValues: { calories: 1, protein: 1, carbs: 1, fat: 1 } };
      const resolvedImage = {
        provider: 'PEXELS',
        providerPhotoId: '12345',
        imageUrl: 'https://images.pexels.com/photos/12345/pexels-photo-12345.jpeg',
        sourceUrl: 'https://www.pexels.com/photo/12345',
        photographer: 'Jane Doe',
        photographerUrl: 'https://www.pexels.com/@janedoe',
        alt: 'A bowl of quinoa salad',
        query: 'ensalada de quinoa food recipe',
        retrievedAt: '2026-09-30T12:00:00.000Z',
      };
      const callOrder: string[] = [];

      pexels.resolveImage.mockImplementation(async (title: string) => {
        callOrder.push(`resolveImage:${title}`);
        return resolvedImage;
      });
      repository.create.mockImplementation(async (data: any) => {
        callOrder.push('repository.create');
        return { id: '1', ...data };
      });

      await service.create(dto as any);

      expect(callOrder).toEqual(['resolveImage:Ensalada de Quinoa', 'repository.create']);
      expect(pexels.resolveImage).toHaveBeenCalledWith(dto.title);
    });

    it('AC3 (NUT-83): el objeto pasado a repository.create incluye el RecipeImage resuelto bajo la clave "image"', async () => {
      const dto = { title: 'Ensalada de Quinoa', prepMinutes: 10, cookMinutes: 20, description: 'Test', ingredients: [], instructions: [], categories: [], properties: [], nutritionalValues: { calories: 1, protein: 1, carbs: 1, fat: 1 } };
      const resolvedImage = {
        provider: 'PEXELS',
        providerPhotoId: '12345',
        imageUrl: 'https://images.pexels.com/photos/12345/pexels-photo-12345.jpeg',
        sourceUrl: 'https://www.pexels.com/photo/12345',
        photographer: 'Jane Doe',
        photographerUrl: 'https://www.pexels.com/@janedoe',
        alt: 'A bowl of quinoa salad',
        query: 'ensalada de quinoa food recipe',
        retrievedAt: '2026-09-30T12:00:00.000Z',
      };

      pexels.resolveImage.mockResolvedValue(resolvedImage);
      repository.create.mockResolvedValue({ id: '1', ...dto, image: resolvedImage });

      await service.create(dto as any);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ ...dto, image: resolvedImage }),
      );
    });

    it('AC4/AC5 (NUT-83): cuando pexels.resolveImage devuelve null (sin resultados o proveedor no disponible), repository.create se llama igual con image: null y create completa exitosamente', async () => {
      const dto = { title: 'Ensalada de Quinoa', prepMinutes: 10, cookMinutes: 20, description: 'Test', ingredients: [], instructions: [], categories: [], properties: [], nutritionalValues: { calories: 1, protein: 1, carbs: 1, fat: 1 } };

      pexels.resolveImage.mockResolvedValue(null);
      repository.create.mockResolvedValue({ id: '1', ...dto, image: null });

      const result = await service.create(dto as any);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ ...dto, image: null }),
      );
      expect(result.id).toBe('1');
    });

    /**
     * NUT-83 revisión de reviewers - Gap 2 (BLOQUEANTE, confirmado independientemente por los
     * 4 revisores): el test AC4/AC5 de arriba sólo cubre el camino documentado de
     * `resolveImage` devolviendo `null` (design.md sección 4: key ausente, sin resultados,
     * 404, timeout, 429, 5xx, JSON inválido — todos esos casos YA están diseñados para
     * resolver en `null`, nunca lanzar). Este test cubre el camino NO documentado: un bug
     * inesperado (`resolveImage` rechazando en vez de resolver en `null`, algo que
     * `PexelsService` no debería hacer según su propio contrato, pero que `RecipeService.create`
     * no debe asumir ciegamente que nunca ocurre). Hoy `RecipeService.create` no tiene ningún
     * try/catch alrededor de `this.pexels.resolveImage(...)`, así que ese rechazo se propaga
     * sin control y `repository.create` nunca se invoca — exactamente lo que design.md D4/
     * Flujo B prohíben ("la receta sigue siendo válida aunque... el proveedor no esté
     * disponible"; nunca debe romper la creación/confirmación de la receta).
     *
     * Debe fallar en rojo hasta que el implementer envuelva la llamada a
     * `this.pexels.resolveImage(...)` en un try/catch que degrade a `image: null` ante
     * cualquier rechazo inesperado, en vez de dejarlo propagar.
     */
    it('Gap 2 (NUT-83, BLOQUEANTE): cuando pexels.resolveImage RECHAZA con una excepción inesperada (bug, no un null documentado), create NO propaga la excepción — completa exitosamente llamando a repository.create con image: null', async () => {
      const dto = { title: 'Ensalada de Quinoa', prepMinutes: 10, cookMinutes: 20, description: 'Test', ingredients: [], instructions: [], categories: [], properties: [], nutritionalValues: { calories: 1, protein: 1, carbs: 1, fat: 1 } };

      pexels.resolveImage.mockRejectedValue(new TypeError('bug inesperado'));
      repository.create.mockResolvedValue({ id: '1', ...dto, image: null });

      const result = await service.create(dto as any);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ ...dto, image: null }),
      );
      expect(result.id).toBe('1');
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
