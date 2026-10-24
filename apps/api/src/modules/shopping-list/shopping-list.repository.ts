import { Injectable } from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ShoppingListItemCheckDto } from './dto/shopping-list-item-check.dto';
import { shoppingItemAbsentWithCurrentToken, shoppingItemNotFound, shoppingListStale } from './shopping-list.errors';
import { transformShoppingList } from './shopping-list.transform';
import { ShoppingListPlan } from './shopping-list.types';

const planSelect = {
  id: true,
  version: true,
  updatedAt: true,
  days: {
    select: {
      meals: {
        select: {
          id: true,
          recipeId: true,
          recipe: { select: { id: true, ingredients: true } },
        },
      },
    },
  },
} as const;

type LockedPlan = { id: string; isCurrent: boolean; updatedAt: Date; startDate: Date };

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
  return [meta?.code, cause?.originalCode].some((code) =>
    code === '40001' || code === '40P01' || code === '55P03');
}

@Injectable()
export class ShoppingListRepository {
  constructor(private readonly prisma: PrismaService) {}

  getCurrentSnapshot(userId: string, weekStart: string): Promise<{
    plan: ShoppingListPlan;
    checks: Array<{ itemKey: string; checked: boolean }>;
  }> {
    const startDate = new Date(`${weekStart}T00:00:00.000Z`);
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.mealPlan.findFirst({
        where: { userId, startDate, isCurrent: true },
        select: planSelect,
      });
      const itemKeys = transformShoppingList(weekStart, plan).items.map((item) => item.key);
      const checks = plan && itemKeys.length ? await tx.shoppingItemCheck.findMany({
        where: { userId, planId: plan.id, itemKey: { in: itemKeys } },
        select: { itemKey: true, checked: true },
      }) : [];
      return { plan, checks };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async setChecked(userId: string, itemKey: string, input: ShoppingListItemCheckDto): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;

        // Parent plan mutations use an UPDATE/DELETE of this row. Lock it first,
        // without changing updatedAt, so the token and item membership stay valid.
        const rows = await tx.$queryRaw<LockedPlan[]>`
          SELECT "id", "isCurrent", "updatedAt", "startDate"
          FROM "meal_plans"
          WHERE "id" = ${input.planId} AND "userId" = ${userId}
          FOR UPDATE
        `;
        const lockedPlan = rows[0];
        if (!lockedPlan) throw shoppingItemNotFound();
        if (!lockedPlan.isCurrent || new Date(lockedPlan.updatedAt).toISOString() !== input.planUpdatedAt) {
          throw shoppingListStale();
        }

        // Recipe updates do not bump the plan token. Share-lock every referenced
        // recipe before reloading the ingredients used to derive the opaque keys.
        const references = await tx.plannedMeal.findMany({
          where: { day: { mealPlanId: lockedPlan.id }, recipeId: { not: null } },
          select: { recipeId: true },
        });
        const recipeIds = [...new Set(references.map(({ recipeId }) => recipeId).filter((id): id is string => id !== null))].sort();
        if (recipeIds.length) {
          await tx.$queryRaw`
            SELECT "id" FROM "recipes"
            WHERE "id" IN (${Prisma.join(recipeIds)})
            ORDER BY "id" FOR SHARE
          `;
        }

        const plan = await tx.mealPlan.findFirst({
          where: { id: lockedPlan.id, userId, isCurrent: true },
          select: planSelect,
        });
        if (!plan) throw shoppingListStale();
        const weekStart = new Date(lockedPlan.startDate).toISOString().slice(0, 10);
        const items = transformShoppingList(weekStart, plan).items;
        if (!items.some((item) => item.key === itemKey)) throw shoppingItemAbsentWithCurrentToken();

        await tx.shoppingItemCheck.upsert({
          where: { userId_planId_itemKey: { userId, planId: lockedPlan.id, itemKey } },
          create: { userId, planId: lockedPlan.id, itemKey, checked: input.checked },
          update: { checked: input.checked },
        });
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 30_000,
      });
    } catch (error) {
      if (isTransactionConflict(error)) throw shoppingListStale();
      throw error;
    }
  }
}
