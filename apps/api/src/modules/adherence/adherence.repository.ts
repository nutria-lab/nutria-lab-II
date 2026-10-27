import { Inject, Injectable } from '@nestjs/common';
import { MealCompletion, Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { adherenceMealNotFound, adherenceStale, mealInFuture } from './adherence.errors';
import { SetMealStatusDto } from './dto/set-meal-status.dto';
import { effectiveMealStatus, mealCompletionSnapshotsMatch } from './effective-meal-status';

type LockedPlan = { id: string; userId: string; isCurrent: boolean };
type LockedMeal = { id: string; planId: string; recipeId: string | null; updatedAt: Date; civilDate: string };
export const ADHERENCE_CLOCK = 'ADHERENCE_CLOCK';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function isTransactionConflict(error: unknown): boolean {
  const prismaError = asRecord(error);
  if (!prismaError) return false;
  if (prismaError.code === 'P2034') return true;
  if (prismaError.code !== 'P2010') return false;

  const meta = asRecord(prismaError.meta);
  const adapter = asRecord(meta?.driverAdapterError);
  const cause = asRecord(adapter?.cause);
  return [meta?.code, cause?.originalCode, cause?.code].some((code) =>
    code === '40001' || code === '40P01' || code === '55P03');
}

function dateInBuenosAires(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${value.year}-${value.month}-${value.day}`;
}

@Injectable()
export class AdherenceRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ADHERENCE_CLOCK) private readonly clock: () => Date = () => new Date(),
  ) {}

  async setMealStatus(userId: string, plannedMealId: string, input: SetMealStatusDto): Promise<MealCompletion> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;

        // Scope the lookup through the owning plan, but keep old versions visible so they
        // return ADHERENCE_STALE instead of being confused with another user's meal.
        const ownedMeal = await tx.plannedMeal.findFirst({
          where: { id: plannedMealId, day: { mealPlan: { userId } } },
          select: { id: true, day: { select: { mealPlanId: true } } },
        });
        if (!ownedMeal) throw adherenceMealNotFound();
        const actualPlanId = ownedMeal.day.mealPlanId;

        // Every writer that can replace/supersede/delete plan content serializes on this
        // parent first. Never change the plan's timestamp while recording adherence.
        const plans = await tx.$queryRaw<LockedPlan[]>`
          SELECT "id", "userId", "isCurrent"
          FROM "meal_plans"
          WHERE "id" = ${actualPlanId} AND "userId" = ${userId}
          FOR UPDATE
        `;
        const plan = plans[0];
        if (!plan) throw adherenceMealNotFound();

        const meals = await tx.$queryRaw<LockedMeal[]>`
          SELECT pm."id", d."mealPlanId" AS "planId", pm."recipeId", pm."updatedAt",
            to_char(d."date", 'YYYY-MM-DD') AS "civilDate"
          FROM "planned_meals" AS pm
          INNER JOIN "meal_plan_days" AS d ON d."id" = pm."dayId"
          WHERE pm."id" = ${plannedMealId} AND d."mealPlanId" = ${plan.id}
          FOR UPDATE OF pm
        `;
        const meal = meals[0];
        if (!meal) throw adherenceMealNotFound();

        if (
          !plan.isCurrent
          || plan.id !== input.planId
          || meal.planId !== plan.id
          || meal.updatedAt.toISOString() !== input.mealUpdatedAt
        ) {
          throw adherenceStale();
        }

        // Read the clock only after both locks, so a request that waited across midnight
        // is validated against the current Buenos Aires civil day.
        if (meal.civilDate > dateInBuenosAires(this.clock())) throw mealInFuture();

        const existing = await tx.mealCompletion.findUnique({ where: { plannedMealId } });
        if (existing && existing.userId !== userId) throw adherenceMealNotFound();

        if (existing && existing.status === input.status) {
          const isIdempotent = input.status === 'NOT_LOGGED'
            ? mealCompletionSnapshotsMatch(existing, meal)
            : effectiveMealStatus(existing, meal) === input.status;

          if (isIdempotent) return existing;
        }

        const completion = await tx.mealCompletion.upsert({
          where: { plannedMealId },
          create: {
            userId,
            plannedMealId,
            recipeIdSnapshot: meal.recipeId,
            mealUpdatedAtSnapshot: meal.updatedAt,
            status: input.status,
          },
          update: {
            status: input.status,
            recipeIdSnapshot: meal.recipeId,
            mealUpdatedAtSnapshot: meal.updatedAt,
          },
        });

        return completion;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 30_000,
      });
    } catch (error) {
      if (isTransactionConflict(error)) throw adherenceStale();
      throw error;
    }
  }
}
