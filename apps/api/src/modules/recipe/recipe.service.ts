import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RecipeRepository } from './recipe.repository';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { ListRecipesQueryDto } from './dto/list-recipes-query.dto';
import { normalizeProperties } from '@/utils/normalize-properties.util';
import { UnsplashService, toPublicRecipeImage } from '@/modules/unsplash/unsplash.service';
import type { RecipeImage, PersistedRecipeImage } from '@/modules/unsplash/recipe-image.types';

@Injectable()
export class RecipeService {
  private readonly logger = new Logger(RecipeService.name);

  constructor(
    private readonly repository: RecipeRepository,
    private readonly unsplash: UnsplashService,
  ) {}

  /**
   * POST /recipes has no transaction of its own (RecipeRepository.create is a single
   * prisma.recipe.create), so D2 is satisfied simply by resolving `image` before building the
   * object passed to repository.create (design.md D1 corregido/D2, plan.md 10.2).
   *
   * resolveImage is designed to never throw (design.md section 4), but create() doesn't blindly
   * assume that contract — an unexpected rejection degrades to image: null instead of blocking
   * recipe creation (Gap 2, PR review).
   *
   * Ciclo B (design.md 12.5.2 paso 3, plan.md 12.2.1): the recipe is persisted FIRST (with
   * `image.tracking.status` still PENDING, whatever resolveImage resolved), and only once that
   * write resolves is tracking invoked and the row updated again, loose, outside any
   * transaction. A tracking failure never affects the recipe/image already persisted (design.md
   * 12.5.4) - the caller always gets back the public 9-field image, never the private
   * `tracking` namespace.
   */
  async create(data: CreateRecipeDto) {
    let image: RecipeImage | null = null;
    try {
      image = await this.unsplash.resolveImage(data.title);
    } catch (error: any) {
      this.logger.error(
        `resolveImage failed unexpectedly (bug, not a routine provider failure) while creating a recipe; continuing with image: null: ${error?.message ?? 'unknown error'}`,
        error?.stack
      );
    }

    const created = await this.repository.create({ ...data, image } as CreateRecipeDto & { image: RecipeImage | null });

    // `image` only carries a `tracking` namespace when the resolver handed back the
    // not-yet-tracked PENDING shape (design.md 12.5.2 paso 1) - resolveImage's own contract is
    // unchanged and already tracks+strips internally (unsplash.service.spec.ts), so this guard
    // keeps create() correct against either shape without assuming one specific caller contract.
    let finalImage: unknown = image;
    if (image && typeof image === 'object' && 'tracking' in image) {
      finalImage = await this.unsplash.trackDownload(image as unknown as PersistedRecipeImage);
      await this.repository.update(created.id, { image: finalImage } as any);
    }

    return { ...created, image: toPublicRecipeImage((finalImage ?? null) as PersistedRecipeImage | null) };
  }

  async findAll(query: ListRecipesQueryDto) {
    const result = await this.repository.findAll({
      ...(query.q ? { q: query.q.trim() } : {}),
      ...(query.properties
        ? { properties: normalizeProperties(query.properties.split(',')) }
        : {}),
      ...(query.maxPrepMinutes !== undefined
        ? { maxPrepMinutes: query.maxPrepMinutes }
        : {}),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 12,
    });

    // Ciclo B (design.md 12.5.1): RecipeRepository.findAll's $queryRaw brings `image` whole
    // (including private tracking metadata) on purpose - filtered here, once, in TypeScript
    // rather than duplicating the public field list in SQL (design.md 12.5.1 rationale).
    return {
      ...result,
      items: result.items.map((item: any) => ({
        ...item,
        image: toPublicRecipeImage((item.image ?? null) as PersistedRecipeImage | null),
      })),
    };
  }

  async findById(id: string) {
    const recipe = await this.repository.findById(id);
    if (!recipe) {
      throw new NotFoundException(`Recipe with ID ${id} not found.`);
    }
    return {
      ...recipe,
      image: toPublicRecipeImage((recipe as any).image as PersistedRecipeImage | null),
    };
  }

  async update(id: string, data: UpdateRecipeDto) {
    await this.findById(id);
    return this.repository.update(id, data);
  }

  async delete(id: string) {
    await this.findById(id);
    return this.repository.delete(id);
  }
}
