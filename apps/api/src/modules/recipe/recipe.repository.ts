import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { Prisma, Recipe } from '@/generated/prisma/client';

export interface ListRecipesCriteria {
  q?: string;
  properties?: string[];
  maxPrepMinutes?: number;
  page: number;
  pageSize: number;
}

export interface PaginatedRecipes {
  items: Recipe[];
  page: number;
  pageSize: number;
  total: number;
}

interface RecipeCount {
  total: bigint | number | string;
}

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

  async findAll(criteria: ListRecipesCriteria): Promise<PaginatedRecipes> {
    const where = this.buildWhereClause(criteria);
    const offset = (criteria.page - 1) * criteria.pageSize;

    const [items, count] = await Promise.all([
      this.prisma.$queryRaw<Recipe[]>`
        SELECT
          "id", "title", "description", "prepMinutes", "cookMinutes",
          "ingredients", "instructions", "categories", "nutritionalValues",
          "properties", "createdAt", "updatedAt"
        FROM "recipes"
        ${where}
        ORDER BY "createdAt" DESC, "id" DESC
        OFFSET ${offset}
        LIMIT ${criteria.pageSize}
      `,
      this.prisma.$queryRaw<RecipeCount[]>`
        SELECT COUNT(*) AS "total"
        FROM "recipes"
        ${where}
      `,
    ]);

    return {
      items,
      page: criteria.page,
      pageSize: criteria.pageSize,
      total: Number(count[0]?.total ?? 0),
    };
  }

  private buildWhereClause(criteria: ListRecipesCriteria): Prisma.Sql {
    const predicates: Prisma.Sql[] = [];

    if (criteria.q) {
      const pattern = `%${this.escapeLikePattern(criteria.q)}%`;
      predicates.push(Prisma.sql`
        (
          unaccent(lower("title")) LIKE unaccent(lower(${pattern})) ESCAPE E'\\\\'
          OR unaccent(lower("description")) LIKE unaccent(lower(${pattern})) ESCAPE E'\\\\'
        )
      `);
    }

    for (const property of criteria.properties ?? []) {
      predicates.push(Prisma.sql`
        EXISTS (
          SELECT 1
          FROM unnest("properties") AS recipe_property
          WHERE lower(recipe_property) = lower(${property})
        )
      `);
    }

    if (criteria.maxPrepMinutes !== undefined) {
      predicates.push(Prisma.sql`"prepMinutes" <= ${criteria.maxPrepMinutes}`);
    }

    return predicates.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(predicates, ' AND ')}`
      : Prisma.empty;
  }

  private escapeLikePattern(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
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
