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

export interface MealTypeCatalogPageCriteria {
  afterId?: string;
  limit: number;
}

interface RecipeCount {
  total: bigint | number | string;
}

export type DuplicateCandidate = Pick<Recipe, 'id' | 'title' | 'description' | 'ingredients' | 'instructions'>;

// Tope de recetas candidatas a duplicado por validación (el catálogo nunca se carga entero).
const MAX_DUPLICATE_CANDIDATES = 100;

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
          "properties", "image", "createdAt", "updatedAt"
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

  /** Stable keyset page used by NUT-76's ephemeral meal-type classifier. */
  async findMealTypeCatalogPage(criteria: MealTypeCatalogPageCriteria): Promise<Recipe[]> {
    if (!Number.isInteger(criteria.limit) || criteria.limit < 1 || criteria.limit > 100) {
      throw new RangeError('limit must be an integer between 1 and 100');
    }

    const cursor = criteria.afterId
      ? Prisma.sql`WHERE "id" > ${criteria.afterId}`
      : Prisma.empty;

    return this.prisma.$queryRaw<Recipe[]>`
      SELECT
        "id", "title", "description", "prepMinutes", "cookMinutes",
        "ingredients", "instructions", "categories", "nutritionalValues",
        "properties", "image", "origin", "generationRunId", "createdAt", "updatedAt"
      FROM "recipes"
      ${cursor}
      ORDER BY "id" ASC
      LIMIT ${criteria.limit}
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

  async findPlannedMealNutritionByRecipeId(recipeId: string) {
    return this.prisma.plannedMeal.findFirst({
      where: { recipeId },
      select: { nutritionalValues: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findByTitle(title: string) {
    return this.prisma.recipe.findFirst({
      where: { title },
    });
  }

  // NUT-74: recetas cuyo título normalizado (minúsculas, sin acentos ni signos, espacios colapsados,
  // igual que normalizeRecipeTitle) es alguno de `titles`. Sólo para detectar duplicados de drafts.
  // unaccent va antes que lower: el texto ya es ASCII y el resultado no depende del locale de la base.
  async findByNormalizedTitles(titles: string[]): Promise<DuplicateCandidate[]> {
    const unique = [...new Set(titles)];
    if (unique.length === 0) return [];

    return this.prisma.$queryRaw<DuplicateCandidate[]>`
      SELECT "id", "title", "description", "ingredients", "instructions"
      FROM "recipes"
      WHERE btrim(regexp_replace(
        regexp_replace(lower(unaccent("title")), '[^[:alnum:][:space:]]+', ' ', 'g'),
        '[[:space:]]+', ' ', 'g'
      )) = ANY(${unique}::text[])
      ORDER BY "id" ASC
      LIMIT ${MAX_DUPLICATE_CANDIDATES}
    `;
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

  // Guarda la imagen completa (un update de una columna Json reemplaza todo el valor).
  // Va aparte de update() porque el cliente nunca puede escribir `image`.
  async updateImage(id: string, image: Prisma.InputJsonValue) {
    return this.prisma.recipe.update({
      where: { id },
      data: { image },
    });
  }

  async delete(id: string) {
    // The existing FK action used to null recipeId without advancing PlannedMeal.updatedAt.
    // Clear each reference explicitly under the same plan -> meal lock order as adherence.
    // A plan referenced after the first scan is retried so its parent can be locked first.
    // A reference that arrives after the re-read is still safe: the FK trigger advances its
    // PlannedMeal token when PostgreSQL performs ON DELETE SET NULL.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx: any) => {
          const recipe = await tx.recipe.findUniqueOrThrow({ where: { id } });
          const references = await tx.$queryRaw<Array<{ planId: string }>>`
            SELECT DISTINCT d."mealPlanId" AS "planId"
            FROM "planned_meals" AS pm
            INNER JOIN "meal_plan_days" AS d ON d."id" = pm."dayId"
            WHERE pm."recipeId" = ${id}
            ORDER BY d."mealPlanId"
          `;

          const lockedPlanIds: string[] = [];
          for (const { planId } of references) {
            const rows = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT "id" FROM "meal_plans" WHERE "id" = ${planId} FOR UPDATE
            `;
            if (rows[0]) lockedPlanIds.push(rows[0].id);
          }

          const meals: Array<{ id: string; planId: string; updatedAt: Date }> = await tx.$queryRaw`
            SELECT pm."id", d."mealPlanId" AS "planId", pm."updatedAt"
            FROM "planned_meals" AS pm
            INNER JOIN "meal_plan_days" AS d ON d."id" = pm."dayId"
            WHERE pm."recipeId" = ${id}
            ORDER BY d."mealPlanId", pm."id"
          `;
          const referencedPlanIds = [...new Set(meals.map((meal) => meal.planId))].sort();
          if (referencedPlanIds.some((planId) => !lockedPlanIds.includes(planId))) {
            // A concurrent plan started referencing this recipe after the first scan.
            // Abort so the next attempt can acquire its parent first.
            throw new RecipeDeleteRetryError();
          }

          const changedAt = new Date();
          for (const meal of meals) {
            await tx.plannedMeal.update({
              where: { id: meal.id },
              data: {
                recipeId: null,
                updatedAt: new Date(Math.max(changedAt.getTime(), new Date(meal.updatedAt).getTime() + 1)),
              },
            });
          }

          await tx.recipe.delete({ where: { id } });
          return recipe;
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 10_000,
          timeout: 30_000,
        });
      } catch (error) {
        if (!(error instanceof RecipeDeleteRetryError)) throw error;
        if (attempt === 2) throw error;
      }
    }
    throw new Error('Recipe deletion retries exhausted');
  }
}

class RecipeDeleteRetryError extends Error {}
