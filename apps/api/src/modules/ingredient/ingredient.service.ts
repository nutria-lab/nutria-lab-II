import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { IngredientRepository } from './ingredient.repository';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';

@Injectable()
export class IngredientService {
  constructor(private readonly repository: IngredientRepository) {}

  async create(data: CreateIngredientDto) {
    const existing = await this.repository.findByName(data.name);
    if (existing) {
      throw new ConflictException(`Ingredient with name '${data.name}' already exists.`);
    }
    return this.repository.create(data);
  }

  async findAll() {
    return this.repository.findAll();
  }

  async findById(id: string) {
    const ingredient = await this.repository.findById(id);
    if (!ingredient) {
      throw new NotFoundException(`Ingredient with ID ${id} not found.`);
    }
    return ingredient;
  }

  async update(id: string, data: UpdateIngredientDto) {
    const existing = await this.findById(id);

    if (data.name && data.name !== existing.name) {
      const conflict = await this.repository.findByName(data.name);
      if (conflict) {
        throw new ConflictException(`Ingredient with name '${data.name}' already exists.`);
      }
    }

    return this.repository.update(id, data);
  }

  async delete(id: string) {
    const ingredient = await this.findById(id);

    const isInUse = await this.repository.isIngredientInUse(ingredient.name);
    if (isInUse) {
      throw new ConflictException(`Cannot delete ingredient '${ingredient.name}' because it is used in one or more recipes.`);
    }

    return this.repository.delete(id);
  }
}
