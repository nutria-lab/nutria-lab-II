import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ShoppingListPlan } from './shopping-list.types';

@Injectable()
export class ShoppingListRepository {
  constructor(private readonly prisma: PrismaService) {}

  findCurrentPlan(userId: string, weekStart: string): Promise<ShoppingListPlan> {
    const startDate = new Date(`${weekStart}T00:00:00.000Z`);

    return this.prisma.mealPlan.findFirst({
      where: { userId, startDate, isCurrent: true },
      select: {
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
      },
    });
  }
}
