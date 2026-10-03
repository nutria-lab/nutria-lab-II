import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RecipeRepository } from './recipe.repository';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { ListRecipesQueryDto } from './dto/list-recipes-query.dto';
import { normalizeProperties } from '@/utils/normalize-properties.util';
import { PexelsService } from '@/modules/pexels/pexels.service';
import type { RecipeImage } from '@/modules/pexels/recipe-image.types';

@Injectable()
export class RecipeService {
  private readonly logger = new Logger(RecipeService.name);

  constructor(
    private readonly repository: RecipeRepository,
    private readonly pexels: PexelsService,
  ) {}

  /**
   * NUT-83 (design.md D1 corregido/D2, plan.md sección 10.2): `POST /recipes` (creación manual
   * individual) es uno de los tres caminos a los que D1 corregido aplica — la resolución de
   * imagen se intenta para TODA receta nueva, sin importar `origin`. No hay ninguna transacción
   * de por medio acá (`RecipeRepository.create` es un único `prisma.recipe.create`), así que D2
   * se satisface resolviendo `image` ANTES de construir el objeto que se pasa a
   * `repository.create`.
   *
   * NUT-83 revisión de reviewers - Gap 2 (bloqueante): `resolveImage` está diseñado para nunca
   * lanzar (design.md sección 4), pero `create` no debe asumir ciegamente ese contrato — ante
   * cualquier rechazo inesperado se degrada a `image: null` (mismo criterio de saneo de logs
   * que `pexels.service.ts`, sin exponer datos sensibles) en vez de dejar que la excepción
   * impida la creación de la receta.
   */
  async create(data: CreateRecipeDto) {
    let image: RecipeImage | null = null;
    try {
      image = await this.pexels.resolveImage(data.title);
    } catch (error: any) {
      // Todo lo que puede fallar del lado de Pexels en sí ya se absorbe dentro de resolveImage
      // y nunca llega hasta acá — si esto se dispara, es un bug real, no un mal día del
      // proveedor. Se loguea como error (con stack) para no confundirlo con los warnings
      // rutinarios de pexels.service.ts; la estrategia sigue siendo degradar, nunca relanzar.
      this.logger.error(
        `resolveImage failed unexpectedly (bug, not a routine provider failure) while creating a recipe; continuing with image: null: ${error?.message ?? 'unknown error'}`,
        error?.stack
      );
    }
    return this.repository.create({ ...data, image } as CreateRecipeDto & { image: RecipeImage | null });
  }

  async findAll(query: ListRecipesQueryDto) {
    return this.repository.findAll({
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
  }

  async findById(id: string) {
    const recipe = await this.repository.findById(id);
    if (!recipe) {
      throw new NotFoundException(`Recipe with ID ${id} not found.`);
    }
    return recipe;
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
