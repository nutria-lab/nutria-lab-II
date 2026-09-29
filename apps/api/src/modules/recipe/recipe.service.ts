import { Injectable, NotFoundException } from '@nestjs/common';
import { RecipeRepository } from './recipe.repository';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { ListRecipesQueryDto } from './dto/list-recipes-query.dto';
import { normalizeProperties } from '@/utils/normalize-properties.util';

@Injectable()
export class RecipeService {
  constructor(private readonly repository: RecipeRepository) {}

  async create(data: CreateRecipeDto) {
    return this.repository.create(data);
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
