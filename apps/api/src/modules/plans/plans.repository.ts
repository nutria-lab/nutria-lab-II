import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MealPlanDayDto } from './dto';
import { isValidTransition, GenerationStatus } from './generation-run-state-machine';

// Estados que ocupan el idempotencyKeyHash (los que no excluye el índice único parcial).
const ACTIVE_RUN_STATUSES = ['PENDING', 'READY_FOR_REVIEW', 'CONFIRMED', 'SUCCEEDED'];

// El plan cambió (u otro reemplazo ganó) entre que se leyó y que se intentó guardar: 409.
export class MealReplacementConflictError extends Error {
  constructor() {
    super('Meal plan changed during the replacement');
    this.name = 'MealReplacementConflictError';
  }
}

// Datos para guardar un reemplazo: o una receta existente del catálogo, o una nueva generada por IA.
export interface MealReplacementWrite {
  userId: string;
  planId: string;
  expectedPlanUpdatedAt: Date;
  plannedMealId: string;
  generationRunId: string;
  existingRecipeId?: string;
  newRecipe?: Record<string, unknown>;
  title?: string;
  nutritionalValues: Record<string, unknown>;
  outputSnapshot: Record<string, unknown>;
  validationSnapshot: Record<string, unknown>;
}

// Copia mínima del tipo de imagen del adaptador. No se importa porque este archivo no puede
// mencionar al adaptador (plans-transaction-no-network.spec.ts lo verifica).
type RecipeImageWithTracking = {
  tracking: { status: 'PENDING' | 'SUCCEEDED' | 'FAILED'; lastAttemptAt: string | null; trackingUrl: string };
  [key: string]: unknown;
};

// Comida a persistir. `reuseRecipeId` lo pone sólo el servidor;
// el ValidationPipe global rechaza esa clave si viene de un cliente.
export type PersistableMeal = MealPlanDayDto['meals'][number] & { reuseRecipeId?: string };

// Opciones del supersede. El PUT pasa la versión que leyó; la regeneración (NUT-78) además su
// updatedAt (control optimista), recetas AI y el resumen de validación de NUT-74.
export interface SupersedeOptions {
  expectedPlanId?: string;
  expectedPlanUpdatedAt?: Date;
  recipeOrigin?: 'MANUAL' | 'AI';
  validationSnapshot?: Record<string, unknown>;
}

// Mismo 409 para todo "el plan cambió mientras se procesaba el pedido".
const PLAN_CHANGED = 'The meal plan changed; retry';

// Recetas creadas con imagen, para que el servicio registre su uso después de la transacción.
// La imagen es el mismo objeto recibido: así el servicio reconoce las que conservó del plan.
export type RecipeForTracking = { recipeId: string; image: RecipeImageWithTracking };

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

  // NUT-78: la versión creada por un run (para el replay idempotente), sea o no la current.
  async findPlanByGenerationRunId(generationRunId: string, userId: string) {
    return this.prisma.mealPlan.findFirst({
      where: { generationRunId, userId },
      include: {
        days: {
          orderBy: { date: 'asc' },
          include: { meals: { include: { recipe: true } } },
        },
      },
    });
  }

  async checkPlanExists(userId: string, weekStart: Date) {
    const plan = await this.prisma.mealPlan.findFirst({
      where: { userId, startDate: weekStart, isCurrent: true },
      select: { id: true }
    });
    return !!plan;
  }

  // Borra esa versión del plan (días y comidas en cascada) sólo si sigue siendo la current del
  // usuario; si una regeneración la reemplazó entretanto, 409 en vez de borrar historia. Devuelve
  // el plan borrado. Las recetas nunca se borran: las comparten otras versiones y otros planes, y el
  // catálogo es compartido (NUT-78, mínimo de NUT-76).
  async deletePlanTransaction(planId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      try {
        return await tx.mealPlan.delete({ where: { id: planId, userId, isCurrent: true } });
      } catch (error: any) {
        if (error?.code === 'P2025') throw new ConflictException(PLAN_CHANGED);
        throw error;
      }
    });
  }

  /**
   * Crea las filas de `MealPlanDay`/`PlannedMeal`/`Recipe` para un plan ya creado, dentro de
   * la transacción recibida.
   */
  private async createDaysMealsAndRecipes(
    tx: any,
    planId: string,
    generatedDays: MealPlanDayDto[],
    generationRunId?: string | null,
    recipeOrigin?: 'MANUAL' | 'AI',
  ): Promise<RecipeForTracking[]> {
    const recipesForTracking: RecipeForTracking[] = [];

    for (const day of generatedDays) {
      const mealPlanDay = await tx.mealPlanDay.create({
        data: { mealPlanId: planId, day: day.day, date: new Date(day.date) }
      });

      for (const meal of day.meals as PersistableMeal[]) {
        let recipeId = null;

        if (meal.reuseRecipeId) {
          // Duplicado exacto de una receta del catálogo; se reutiliza, no se crea otra.
          recipeId = meal.reuseRecipeId;
        } else if (meal.recipe) {
          const recipeData: any = {
            title: meal.recipe.title,
            description: meal.recipe.description,
            prepMinutes: meal.recipe.prepMinutes,
            cookMinutes: meal.recipe.cookMinutes,
            ingredients: meal.recipe.ingredients as any,
            instructions: meal.recipe.instructions,
          };

          if (generationRunId) {
            recipeData.generationRunId = generationRunId;
          }

          if (recipeOrigin) {
            recipeData.origin = recipeOrigin;
          }

          // `image` ya viene resuelto desde el servicio: sólo se copia, sin red .
          const recipeImage = (meal.recipe as { image?: unknown }).image;
          if (recipeImage !== undefined) {
            recipeData.image = recipeImage;
          }

          const recipe = await tx.recipe.create({ data: recipeData });
          recipeId = recipe.id;

          // Sólo se anota la receta (sin red); el servicio decide después a cuáles registrar.
          if (
            recipeImage !== undefined &&
            recipeImage !== null &&
            typeof recipeImage === 'object' &&
            'tracking' in (recipeImage as object)
          ) {
            recipesForTracking.push({ recipeId, image: recipeImage as RecipeImageWithTracking });
          }
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

    return recipesForTracking;
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

  /**
   * NUT-75 Bug 1: `createPlanTransaction` sólo se llama desde `validateAndPersistPlan`. Cuando
   * ese método es invocado desde `generateAndPersistPlan` (camino real de Gemini) siempre trae
   * un `generationRunId` definido, y en ese caso corresponde `recipeOrigin: 'AI'`. Cuando se
   * invoca directo desde `POST /meal-plans` (sin `generationRunId`), no corresponde ningún
   * `recipeOrigin` explícito, para que el `@default(MANUAL)` de Prisma siga aplicando sin
   * cambios de comportamiento ahí. El default de este parámetro replica exactamente esa regla
   * sin necesitar que el caller la recalcule; un caller puede igualmente pasar `recipeOrigin`
   * explícito si alguna vez hiciera falta desacoplarlo más.
   */
  async createPlanTransaction(
    userId: string,
    weekStart: Date,
    generatedDays: MealPlanDayDto[],
    generationRunId?: string | null,
    recipeOrigin: 'MANUAL' | 'AI' | undefined = generationRunId ? 'AI' : undefined,
    // NUT-74: resumen del validador determinístico; sin él se guarda el snapshot legado { restrictionsChecked: true }.
    validationSnapshot?: Record<string, unknown>,
  ): Promise<{ planId: string; recipesForTracking: RecipeForTracking[] }> {
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

      const recipesForTracking = await this.createDaysMealsAndRecipes(
        tx,
        plan.id,
        generatedDays,
        generationRunId,
        recipeOrigin,
      );

      if (generationRunId) {
        // Gap 6 (medio, design.md Flujo C paso 1b: "con outputSnapshot/validationSnapshot ya
        // poblados"). Resumen mínimo pero no vacío de lo persistido: no es exhaustivo (no
        // duplica el contenido completo de `days`, que ya vive en las filas de dominio
        // recién creadas), sólo evidencia de qué se confirmó y que la validación de dominio
        // corrió antes de llegar acá.
        await this.transitionGenerationRunInTx(tx, generationRunId, userId, ['PENDING'], 'SUCCEEDED', {
          outputSnapshot: this.buildOutputSnapshot(generatedDays),
          validationSnapshot: validationSnapshot ?? { restrictionsChecked: true },
        });
      }

      return { planId: plan.id, recipesForTracking };
    });
  }


 
  private buildOutputSnapshot(days: MealPlanDayDto[]): { days: MealPlanDayDto[] } {
    const sanitizedDays = days.map(day => ({
      ...day,
      meals: day.meals.map(meal => {
        if (!meal.recipe) {
          return meal;
        }
        const { image, ...recipeWithoutImage } = meal.recipe as any;
        return { ...meal, recipe: recipeWithoutImage };
      }),
    }));

    return { days: sanitizedDays as MealPlanDayDto[] };
  }

  /**
   * Supersede de la versión current de la semana (PUT y regeneración de NUT-78): en vez de borrar y
   * recrear, la marca como no-actual y crea una nueva versión encadenada, todo en la misma
   * transacción y en orden UPDATE-antes-que-INSERT. Si se pasa la versión esperada, cualquier
   * cambio de la current entre la lectura y la transacción da 409.
   */
  async updatePlanTransaction(
    userId: string,
    weekStart: Date,
    newDays: MealPlanDayDto[],
    generationRunId: string,
    options: SupersedeOptions = {},
  ): Promise<{ planId: string; recipesForTracking: RecipeForTracking[] }> {
    return this.prisma.$transaction(async (tx: any) => {
      // 1. Ubicar la versión actual.
      const current = await tx.mealPlan.findFirst({
        where: { userId, startDate: weekStart, isCurrent: true },
      });

      // Con versión esperada, que la current sea otra o ya no exista (se borró) es un conflicto: no se
      // toca nada. Sin versión esperada se mantiene el error previo.
      if (options.expectedPlanId && current?.id !== options.expectedPlanId) {
        throw new ConflictException(PLAN_CHANGED);
      }
      if (!current) {
        throw new Error('No current plan version found to supersede for this week');
      }

      // 2. Marcar la versión actual como no-actual (debe ocurrir antes del insert siguiente), sólo si
      // sigue current y, si se pidió, sin cambios desde que se leyó: si no, 0 filas → 409.
      const superseded = await tx.mealPlan.updateMany({
        where: {
          id: current.id,
          userId,
          isCurrent: true,
          ...(options.expectedPlanUpdatedAt ? { updatedAt: options.expectedPlanUpdatedAt } : {}),
        },
        data: { isCurrent: false },
      });
      if (superseded.count === 0) {
        throw new ConflictException(PLAN_CHANGED);
      }

      // 3. Insertar la nueva versión.
      // Gap 4 (alto, AC2): el índice único parcial `meal_plans_user_week_current_key`
      // (`WHERE isCurrent = true`) es lo que impide dos versiones "actuales" simultáneas para
      // el mismo (userId, startDate). Si ese insert viola la unicidad 
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
          throw new ConflictException(PLAN_CHANGED);
        }
        throw error;
      }

      // 4. Crear días/comidas/recetas nuevas colgando de la nueva versión.
      // `PUT /meal-plans` es edición manual (MANUAL); la regeneración (NUT-78) pasa 'AI'.
      const recipesForTracking = await this.createDaysMealsAndRecipes(
        tx, newPlan.id, newDays, generationRunId, options.recipeOrigin ?? 'MANUAL',
      );

      // 5. Transición del GenerationRun a SUCCEEDED (Gap 6: con outputSnapshot/validationSnapshot).
      await this.transitionGenerationRunInTx(tx, generationRunId, userId, ['PENDING'], 'SUCCEEDED', {
        outputSnapshot: this.buildOutputSnapshot(newDays),
        validationSnapshot: options.validationSnapshot ?? { restrictionsChecked: true },
      });

      return { planId: newPlan.id, recipesForTracking };
    });
  }

  /**
   * Crea un `GenerationRun` nuevo; si ya existe uno con el mismo `(userId, kind,
   * idempotencyKeyHash)` en un estado que sigue participando de la unicidad, recupera y devuelve el existente en vez de lanzar
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
    canRetry = true,
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
        // Sólo los runs activos ocupan la clave
        // un FAILED/REJECTED/EXPIRED viejo con el mismo hash nunca se devuelve.
        const active = await (this.prisma.generationRun.findMany as any)({
          where: { userId, kind, idempotencyKeyHash, status: { in: ACTIVE_RUN_STATUSES } },
        });
        const existing = active.find((run: any) => run.status === 'SUCCEEDED' || run.status === 'CONFIRMED') ?? active[0];
        if (existing) {
          return { run: existing, wasCreated: false };
        }
        // El run activo terminó mal justo entre el choque y la lectura: la clave ya está libre.
        if (canRetry) {
          return this.createOrRecoverGenerationRun(
            userId, kind, provider, model, promptVersion, schemaVersion, requestSnapshot, profileSnapshot, idempotencyKeyHash, false,
          );
        }
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

  // Guarda el resultado del registro de uso, fuera de la transacción. Escribe la imagen completa
  // porque un update de una columna Json reemplaza todo el valor.
  async updateRecipeImageTracking(recipeId: string, fullImage: RecipeImageWithTracking): Promise<void> {
    await this.prisma.recipe.update({
      where: { id: recipeId },
      data: { image: fullImage as any },
    });
  }

  /**
   * Nunca `findUnique` por sólo `id`: el `where` siempre filtra también por `userId`, para que
   * sea estructuralmente imposible leer la ejecución de otro usuario (AC4).
   */
  async findGenerationRunById(id: string, userId: string) {
    return this.prisma.generationRun.findFirst({ where: { id, userId } });
  }

  // Busca el plan sólo por id (sin filtrar por usuario) para poder distinguir 403 de 404.
  async findPlanWithMeals(planId: string) {
    return this.prisma.mealPlan.findUnique({
      where: { id: planId },
      // Con las recetas: la regeneración (NUT-78) compara la propuesta contra la versión anterior.
      include: { days: { include: { meals: { include: { recipe: true } } } } },
    });
  }

  async findRecipeById(id: string) {
    return this.prisma.recipe.findUnique({ where: { id } });
  }

  // Guarda el reemplazo de UNA comida. Si algo falla, Prisma revierte todo junto.
  async replaceMealTransaction(input: MealReplacementWrite) {
    return this.prisma.$transaction(async (tx: any) => {
      // Control optimista: sólo sigue si el plan no cambió desde que se leyó y sigue siendo el actual.
      const locked = await tx.mealPlan.updateMany({
        where: { id: input.planId, userId: input.userId, isCurrent: true, updatedAt: input.expectedPlanUpdatedAt },
        data: { updatedAt: new Date() },
      });
      if (locked.count === 0) {
        throw new MealReplacementConflictError();
      }

      const recipe = input.newRecipe
        ? await tx.recipe.create({ data: { ...input.newRecipe, origin: 'AI', generationRunId: input.generationRunId } })
        : await tx.recipe.findUniqueOrThrow({ where: { id: input.existingRecipeId } });

      // Sólo cambia la comida objetivo; la receta anterior queda en el catálogo.
      const plannedMeal = await tx.plannedMeal.update({
        where: { id: input.plannedMealId },
        data: { recipeId: recipe.id, title: input.title ?? recipe.title, nutritionalValues: input.nutritionalValues },
      });

      await this.transitionGenerationRunInTx(tx, input.generationRunId, input.userId, ['PENDING'], 'SUCCEEDED', {
        outputSnapshot: { ...input.outputSnapshot, recipeId: recipe.id, title: plannedMeal.title },
        validationSnapshot: input.validationSnapshot,
      });

      return { recipe, plannedMeal };
    });
  }
}
