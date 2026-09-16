import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';

@Injectable()
export class RecipeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateRecipeDto) {
    return this.prisma.recipe.create({
      data: {
        ...data,
        ingredients: data.ingredients as any,
        nutritionalValues: data.nutritionalValues as any,
      },
    });
  }

  async findAll() {
    return this.prisma.recipe.findMany();
  }

  async findById(id: string) {
    return this.prisma.recipe.findUnique({
      where: { id },
    });
  }

  async findByTitle(title: string) {
    return this.prisma.recipe.findFirst({
      where: { title },
    });
  }

  async update(id: string, data: UpdateRecipeDto) {
    return this.prisma.recipe.update({
      where: { id },
      data: {
        ...data,
        ...(data.ingredients ? { ingredients: data.ingredients as any } : {}),
        ...(data.nutritionalValues ? { nutritionalValues: data.nutritionalValues as any } : {}),
      },
    });
  }

  async delete(id: string) {
    return this.prisma.recipe.delete({
      where: { id },
    });
  }
}
