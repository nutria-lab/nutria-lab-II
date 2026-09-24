import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MealPlanDayDto } from './dto';
import { isValidTransition, GenerationStatus } from './generation-run-state-machine';

@Injectable()
export class PlansRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getUserWithProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: { nutritionProfile: true },
    });
  }

  async findPlanByWeek(userId: string, weekStart: Date) {
    return this.prisma.mealPlan.findFirst({
      where: { userId, startDate: weekStart, isCurrent: true },
      include: {
        days: {
          orderBy: { date: 'asc' },
          include: {
            meals: {
              include: { recipe: true }
            }
          }
        }
      }
    });
  }

  async checkPlanExists(userId: string, weekStart: Date) {
    const plan = await this.prisma.mealPlan.findFirst({
      where: { userId, startDate: weekStart, isCurrent: true },
      select: { id: true }
    });
    return !!plan;
  }

  async deletePlanTransaction(planId: string, recipeIds: string[]){
    return this.prisma.$transaction(async (tx) => {
      // 1. Borrar el plan (borra días y comidas en cascada)
      const deletedPlan = await tx.mealPlan.delete({
        where: { id: planId }
      });

      // 2. Borrar las recetas huérfanas pasadas por el servicio
      if (recipeIds.length > 0) {
        const inUseRecipes = await tx.plannedMeal.findMany({
          where: { recipeId: { in: recipeIds } },
          select: { recipeId: true }
        });
        const inUseSet = new Set(inUseRecipes.map(r => r.recipeId));
        const toDelete = recipeIds.filter(id => id && !inUseSet.has(id)) as string[];

        if (toDelete.length > 0) {
          await tx.recipe.deleteMany({
            where: { id: { in: toDelete } }
          });
        }
      }

      return deletedPlan;
    });
  }

  /**
   * Crea las filas de `MealPlanDay`/`PlannedMeal`/`Recipe` para un plan ya creado, dentro de
   * la transacción recibida. Cuando `generationRunId` viene definido, cada `Recipe` creada
   * queda estampada con `origin: 'AI'` y `generationRunId` (design.md Flujo C paso 1a); si no
   * viene definido (camino manual, `POST /meal-plans`), las recetas quedan con el
   * `@default(MANUAL)` de Prisma sin tocar el campo.
   */
  private async createDaysMealsAndRecipes(
    tx: any,
    planId: string,
    generatedDays: MealPlanDayDto[],
    generationRunId?: string | null,
  ) {
    for (const day of generatedDays) {
      const mealPlanDay = await tx.mealPlanDay.create({
        data: { mealPlanId: planId, day: day.day, date: new Date(day.date) }
      });

      for (const meal of day.meals) {
        let recipeId = null;

        if (meal.recipe) {
          const recipeData: any = {
            title: meal.recipe.title,
            description: meal.recipe.description,
            prepMinutes: meal.recipe.prepMinutes,
            cookMinutes: meal.recipe.cookMinutes,
            ingredients: meal.recipe.ingredients as any,
            instructions: meal.recipe.instructions,
          };

          if (generationRunId) {
            recipeData.origin = 'AI';
            recipeData.generationRunId = generationRunId;
          }

          const recipe = await tx.recipe.create({ data: recipeData });
          recipeId = recipe.id;
        }

        await tx.plannedMeal.create({
          data: {
            dayId: mealPlanDay.id,
            mealType: meal.mealType,
            title: meal.title,
            nutritionalValues: meal.nutritionalValues,
            recipeId,
          }
        });
      }
    }
  }

  /**
   * NUT-75 Gap 5 (medio, design.md sección 7 punto 1): valida que AL MENOS uno de los
   * `fromStatuses` tenga una transición legal hacia `toStatus` según la máquina de estados de
   * `generation-run-state-machine.ts` (la fuente de verdad de aplicación, testeable sin
   * Prisma). Si ninguno la tiene, lanza sin tocar la base de datos en absoluto — la validación
   * en código de aplicación no depende sólo del respaldo de concurrencia de la base.
   */
  private assertHasValidTransitionOrigin(fromStatuses: string[], toStatus: string, runId: string): void {
    const hasValidOrigin = fromStatuses.some(from =>
      isValidTransition(from as GenerationStatus, toStatus as GenerationStatus)
    );

    if (!hasValidOrigin) {
      throw new Error(
        `GenerationRun transition rejected: none of [${fromStatuses.join(', ')}] can transition to ${toStatus} ` +
          `for run ${runId}`
      );
    }
  }

  /**
   * Transición condicional de `GenerationRun` ejecutada dentro de una transacción ya abierta
   * (`tx`, no `this.prisma`). Si el `updateMany` afecta 0 filas (alguien ya movió el run a
   * otro estado — condición de carrera, design.md Flujo C paso 1c), lanza para abortar la
   * transacción completa.
   */
  private async transitionGenerationRunInTx(
    tx: any,
    id: string,
    userId: string,
    fromStatuses: string[],
    toStatus: string,
    data?: Record<string, any>,
  ) {
    this.assertHasValidTransitionOrigin(fromStatuses, toStatus, id);

    const result = await tx.generationRun.updateMany({
      where: { id, userId, status: { in: fromStatuses } },
      data: { status: toStatus, completedAt: new Date(), ...data },
    });

    if (result.count === 0) {
      throw new Error(`GenerationRun transition conflict: could not move run ${id} to ${toStatus}`);
    }

    return result.count;
  }

  async createPlanTransaction(
    userId: string,
    weekStart: Date,
    generatedDays: MealPlanDayDto[],
    generationRunId?: string | null,
  ) {
    return this.prisma.$transaction(async (tx: any) => {
      const planData: any = {
        userId,
        startDate: weekStart,
        endDate: new Date(new Date(weekStart).getTime() + 6 * 24 * 60 * 60 * 1000),
      };

      if (generationRunId) {
        planData.generationRunId = generationRunId;
      }

      const plan = await tx.mealPlan.create({ data: planData });

      await this.createDaysMealsAndRecipes(tx, plan.id, generatedDays, generationRunId);

      if (generationRunId) {
        // Gap 6 (medio, design.md Flujo C paso 1b: "con outputSnapshot/validationSnapshot ya
        // poblados"). Resumen mínimo pero no vacío de lo persistido: no es exhaustivo (no
        // duplica el contenido completo de `days`, que ya vive en las filas de dominio
        // recién creadas), sólo evidencia de qué se confirmó y que la validación de dominio
        // corrió antes de llegar acá.
        await this.transitionGenerationRunInTx(tx, generationRunId, userId, ['PENDING'], 'SUCCEEDED', {
          outputSnapshot: this.buildOutputSnapshot(generatedDays),
          validationSnapshot: { restrictionsChecked: true },
        });
      }

      return plan.id;
    });
  }

  /**
   * Resumen mínimo (no exhaustivo) de lo persistido, usado como `outputSnapshot` de la
   * transición final a `SUCCEEDED` (Gap 6). Deliberadamente no copia el contenido completo de
   * `days` (eso ya vive en `MealPlanDay`/`PlannedMeal`/`Recipe`), sólo conteos que sirvan de
   * evidencia rápida sin duplicar datos de dominio en la tabla de trazabilidad.
   */
  private buildOutputSnapshot(days: MealPlanDayDto[]): { dayCount: number; mealCount: number } {
    return {
      dayCount: days.length,
      mealCount: days.reduce((sum, day) => sum + (day.meals?.length ?? 0), 0),
    };
  }

  /**
   * Flujo D (supersede): en vez de borrar y recrear, marca la versión actual como no-actual y
   * crea una nueva versión encadenada, todo dentro de la misma transacción, respetando el
   * orden UPDATE-antes-que-INSERT (design.md Flujo D, "Nota de orden y concurrencia").
   */
  async updatePlanTransaction(
    userId: string,
    weekStart: Date,
    newDays: MealPlanDayDto[],
    generationRunId: string,
  ) {
    return this.prisma.$transaction(async (tx: any) => {
      // 1. Ubicar la versión actual.
      const current = await tx.mealPlan.findFirst({
        where: { userId, startDate: weekStart, isCurrent: true },
      });

      if (!current) {
        throw new Error('No current plan version found to supersede for this week');
      }

      // 2. Marcar la versión actual como no-actual (debe ocurrir antes del insert siguiente).
      await tx.mealPlan.update({
        where: { id: current.id },
        data: { isCurrent: false },
      });

      // 3. Insertar la nueva versión.
      // Gap 4 (alto, AC2): el índice único parcial `meal_plans_user_week_current_key`
      // (`WHERE isCurrent = true`) es lo que impide dos versiones "actuales" simultáneas para
      // el mismo (userId, startDate). Si ese insert viola la unicidad (P2002 — por ejemplo,
      // una regeneración concurrente que ya insertó su propia versión actual entre el paso 1 y
      // este paso), se traduce a un error de dominio manejado (ConflictException) en vez de
      // dejar que la excepción cruda de Prisma llegue al usuario como 500 genérico.
      let newPlan: any;
      try {
        newPlan = await tx.mealPlan.create({
          data: {
            userId,
            startDate: weekStart,
            endDate: new Date(new Date(weekStart).getTime() + 6 * 24 * 60 * 60 * 1000),
            version: current.version + 1,
            isCurrent: true,
            supersedesId: current.id,
            generationRunId,
          },
        });
      } catch (error: any) {
        if (error?.code === 'P2002') {
          throw new ConflictException(
            'Ya existe una versión actual para esta semana (conflicto de unicidad al crear la nueva versión del plan).'
          );
        }
        throw error;
      }

      // 4. Crear días/comidas/recetas nuevas colgando de la nueva versión.
      await this.createDaysMealsAndRecipes(tx, newPlan.id, newDays, generationRunId);

      // 5. Transición del GenerationRun a SUCCEEDED (Gap 6: con outputSnapshot/validationSnapshot).
      await this.transitionGenerationRunInTx(tx, generationRunId, userId, ['PENDING'], 'SUCCEEDED', {
        outputSnapshot: this.buildOutputSnapshot(newDays),
        validationSnapshot: { restrictionsChecked: true },
      });

      return newPlan.id;
    });
  }

  /**
   * Crea un `GenerationRun` nuevo; si ya existe uno con el mismo `(userId, kind,
   * idempotencyKeyHash)` (violación del `@@unique`, código Prisma `P2002`), recupera y
   * devuelve el existente en vez de lanzar (Flujo A paso 5, AC3).
   */
  async createOrRecoverGenerationRun(
    userId: string,
    kind: string,
    provider: string,
    model: string,
    promptVersion: string,
    schemaVersion: string,
    requestSnapshot: unknown,
    profileSnapshot: unknown,
    idempotencyKeyHash: string,
  ): Promise<{ run: any; wasCreated: boolean }> {
    try {
      const run = await (this.prisma.generationRun.create as any)({
        data: {
          userId,
          kind,
          provider,
          model,
          promptVersion,
          schemaVersion,
          requestSnapshot,
          profileSnapshot,
          idempotencyKeyHash,
        },
      });
      return { run, wasCreated: true };
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const existing = await (this.prisma.generationRun.findFirst as any)({
          where: { userId, kind, idempotencyKeyHash },
        });
        return { run: existing, wasCreated: false };
      }
      throw error;
    }
  }

  /**
   * Transición condicional de `GenerationRun` fuera de una transacción de dominio (por
   * ejemplo, para marcar `FAILED`/`REJECTED` tras un error). Usa `updateMany` con el estado de
   * origen esperado y devuelve el conteo de filas afectadas: 0 significa transición inválida o
   * condición de carrera (design.md sección 7).
   */
  async transitionGenerationRun(
    id: string,
    userId: string,
    fromStatuses: string[],
    toStatus: string,
    data?: Record<string, any>,
  ): Promise<number> {
    this.assertHasValidTransitionOrigin(fromStatuses, toStatus, id);

    const result = await (this.prisma.generationRun.updateMany as any)({
      where: { id, userId, status: { in: fromStatuses } },
      data: { status: toStatus, completedAt: new Date(), ...data },
    });

    return result.count;
  }

  /**
   * Nunca `findUnique` por sólo `id`: el `where` siempre filtra también por `userId`, para que
   * sea estructuralmente imposible leer la ejecución de otro usuario (AC4).
   */
  async findGenerationRunById(id: string, userId: string) {
    return this.prisma.generationRun.findFirst({ where: { id, userId } });
  }
}
