import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';

@Injectable()
export class IngredientRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateIngredientDto) {
    return this.prisma.ingredient.create({
      data: {
        ...data,
        nutritionalValues: data.nutritionalValues as any,
      },
    });
  }

  async findAll() {
    return this.prisma.ingredient.findMany();
  }

  async findById(id: string) {
    return this.prisma.ingredient.findUnique({
      where: { id },
    });
  }

  async findByName(name: string) {
    return this.prisma.ingredient.findUnique({
      where: { name },
    });
  }

  async update(id: string, data: UpdateIngredientDto) {
    return this.prisma.ingredient.update({
      where: { id },
      data: {
        ...data,
        ...(data.nutritionalValues ? { nutritionalValues: data.nutritionalValues as any } : {}),
      },
    });
  }

  async delete(id: string) {
    return this.prisma.ingredient.delete({
      where: { id },
    });
  }

  // Al guardar los ingredientes como JSON, tenemos que hacer una raw query para buscar ahi adentro
  async isIngredientInUse(name: string): Promise<boolean> {
    const usedInRecipes = await this.prisma.$queryRaw<{id: string}[]>`
      SELECT id FROM "recipes"
      WHERE "ingredients" @> ${JSON.stringify([{ name }])}::jsonb
      LIMIT 1
    `;
    return usedInRecipes.length > 0;
  }
}
