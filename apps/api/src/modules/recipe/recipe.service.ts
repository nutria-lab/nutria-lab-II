import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RecipeRepository } from './recipe.repository';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { ListRecipesQueryDto } from './dto/list-recipes-query.dto';
import { normalizeProperties } from '@/utils/normalize-properties.util';
import { UnsplashService, toPublicRecipeImage } from '@/modules/unsplash/unsplash.service';
import type { PersistedRecipeImage } from '@/modules/unsplash/recipe-image.types';

// Toda receta que devuelve este servicio pasa por acá: la imagen guardada tiene metadata
// privada de tracking que no puede llegar al cliente.
function withPublicImage<T extends object>(recipe: T) {
  const image = ((recipe as { image?: unknown }).image ?? null) as PersistedRecipeImage | null;
  return { ...recipe, image: toPublicRecipeImage(image) };
}

@Injectable()
export class RecipeService {
  private readonly logger = new Logger(RecipeService.name);

  constructor(
    private readonly repository: RecipeRepository,
    private readonly unsplash: UnsplashService,
  ) {}

  // POST /recipes: 1) buscar foto, 2) guardar la receta con el tracking en PENDING,
  // 3) recién ahí registrar el uso en Unsplash y guardar el resultado.
  async create(data: CreateRecipeDto) {
    let image: PersistedRecipeImage | null = null;
    // searchAndSelectCandidate no lanza; este catch es sólo por si hay un bug: la receta se crea igual.
    try {
      image = await this.unsplash.searchAndSelectCandidate(data.title);
    } catch (error: any) {
      this.logger.error(
        `Image search failed unexpectedly (bug, not a routine provider failure) while creating a recipe; continuing with image: null: ${error?.message ?? 'unknown error'}`,
        error?.stack,
      );
    }

    const created = await this.repository.create({ ...data, image } as CreateRecipeDto & { image: PersistedRecipeImage | null });

    // Si guardar la receta falla, la línea de arriba lanza y nunca se registra el uso.
    const finalImage = image ? await this.trackPersistedImage(created.id, image) : null;

    return withPublicImage({ ...created, image: finalImage });
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

    return { ...result, items: result.items.map(withPublicImage) };
  }

  async findById(id: string) {
    const recipe = await this.repository.findById(id);
    if (!recipe) {
      throw new NotFoundException(`Recipe with ID ${id} not found.`);
    }
    return withPublicImage(recipe);
  }

  async update(id: string, data: UpdateRecipeDto) {
    await this.findById(id);
    return withPublicImage(await this.repository.update(id, data));
  }

  async delete(id: string) {
    await this.findById(id);
    return withPublicImage(await this.repository.delete(id));
  }

  // Registra el uso y guarda SUCCEEDED/FAILED. Si guardar ese resultado falla, la receta queda
  // PENDING para el script de recuperación y la request igual responde bien.
  private async trackPersistedImage(recipeId: string, image: PersistedRecipeImage): Promise<PersistedRecipeImage> {
    const tracked = await this.unsplash.trackDownload(image);
    try {
      await this.repository.updateImage(recipeId, tracked);
      return tracked;
    } catch {
      this.logger.warn(`Could not save Unsplash tracking status for recipeId=${recipeId}; it stays PENDING for recovery`);
      return image;
    }
  }
}
