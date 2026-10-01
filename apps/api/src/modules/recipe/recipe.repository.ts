import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { Prisma, Recipe, RecipeCategory } from '@/generated/prisma/client';
import { RecipeCoverageCandidate, RecipeCoverageCriteria } from './recipe-coverage.types';

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
    return this.buildRecipeWhereClause(criteria);
  }

  private buildRecipeWhereClause(criteria: Pick<ListRecipesCriteria, 'q' | 'properties' | 'maxPrepMinutes'>): Prisma.Sql {
    const predicates: Prisma.Sql[] = [];

    if (criteria.q) {
      predicates.push(this.topicPredicate(criteria.q));
    }

    for (const property of criteria.properties ?? []) {
      predicates.push(this.propertyPredicate(property));
    }

    if (criteria.maxPrepMinutes !== undefined) {
      predicates.push(Prisma.sql`"prepMinutes" <= ${criteria.maxPrepMinutes}`);
    }

    return predicates.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(predicates, ' AND ')}`
      : Prisma.empty;
  }

  async findCoverageCandidates(criteria: RecipeCoverageCriteria): Promise<RecipeCoverageCandidate[]> {
    const where = this.buildCoverageClause(criteria);

    return this.prisma.$queryRaw<RecipeCoverageCandidate[]>`
      SELECT
        "id", "title", "description", "prepMinutes", "cookMinutes",
        "ingredients", "instructions", "categories", "nutritionalValues", "properties",
        "origin", "generationRunId", "createdAt", "updatedAt",
        coverage_rank.score AS score,
        coverage_rank.topic AS topic
      FROM "recipes"
      ${where}
      ORDER BY score DESC, topic DESC, "prepMinutes" ASC, "id" ASC
      LIMIT ${criteria.desiredTotal}
    `;
  }

  private buildCoverageClause(criteria: RecipeCoverageCriteria): Prisma.Sql {
    const predicates: Prisma.Sql[] = [];

    if (criteria.categories.length) {
      predicates.push(this.categoryOverlapPredicate(criteria.categories));
    }
    for (const group of criteria.requiredCategoryGroups) {
      predicates.push(this.categoryOverlapPredicate(group));
    }
    for (const property of criteria.properties) {
      predicates.push(this.propertyPredicate(property));
    }
    if (criteria.maxPrepMinutes !== undefined) {
      predicates.push(Prisma.sql`"prepMinutes" <= ${criteria.maxPrepMinutes}`);
    }
    if (criteria.excludeRecipeIds.length) {
      predicates.push(Prisma.sql`"id" NOT IN (${Prisma.join(criteria.excludeRecipeIds)})`);
    }
    return Prisma.sql`
      CROSS JOIN LATERAL (
        SELECT ${this.scoreExpression(criteria)} AS score, ${this.topicMatchExpression(criteria.topic)} AS topic
      ) AS coverage_rank
      ${predicates.length ? Prisma.sql`WHERE ${Prisma.join(predicates, ' AND ')}` : Prisma.empty}
    `;
  }

  private scoreExpression(criteria: RecipeCoverageCriteria): Prisma.Sql {
    const categoryScore = criteria.categories.length
      ? Prisma.sql`cardinality(ARRAY(SELECT 1 FROM unnest("categories") AS category WHERE category IN (${Prisma.join(criteria.categories)})))`
      : Prisma.sql`0`;
    const propertyScore = criteria.properties.length
      ? Prisma.sql`cardinality(ARRAY(SELECT 1 FROM unnest("properties") AS recipe_property WHERE lower(recipe_property) IN (${Prisma.join(criteria.properties.map(property => property.toLowerCase()))})))`
      : Prisma.sql`0`;
    return Prisma.sql`${categoryScore} + ${propertyScore}`;
  }

  private categoryOverlapPredicate(categories: RecipeCategory[]): Prisma.Sql {
    return Prisma.sql`"categories" && ARRAY[${Prisma.join(categories)}]::"RecipeCategory"[]`;
  }

  private topicPredicate(topic: string): Prisma.Sql {
    const match = this.topicMatchExpression(topic);
    return Prisma.sql`(${match})`;
  }

  private topicMatchExpression(topic?: string): Prisma.Sql {
    if (!topic) return Prisma.sql`FALSE`;
    const pattern = `%${this.escapeLikePattern(topic)}%`;
    return Prisma.sql`
      (
        unaccent(lower("title")) LIKE unaccent(lower(${pattern})) ESCAPE E'\\\\'
        OR unaccent(lower("description")) LIKE unaccent(lower(${pattern})) ESCAPE E'\\\\'
      )
    `;
  }

  private propertyPredicate(property: string): Prisma.Sql {
    return Prisma.sql`
      EXISTS (
        SELECT 1
        FROM unnest("properties") AS recipe_property
        WHERE lower(recipe_property) = lower(${property})
      )
    `;
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
