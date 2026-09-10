import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MealPlanDayDto } from './dto';

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
    return this.prisma.mealPlan.findUnique({
      where: { userId_startDate: { userId, startDate: weekStart } },
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
    const plan = await this.prisma.mealPlan.findUnique({
      where: { userId_startDate: { userId, startDate: weekStart } },
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

  async createPlanTransaction(userId: string, weekStart: Date, generatedDays: MealPlanDayDto[], txClient?: any) {
    const client = txClient || this.prisma;
    return client.$transaction(async (tx: any) => {
      const plan = await tx.mealPlan.create({
        data: {
          userId,
          startDate: weekStart,
          endDate: new Date(new Date(weekStart).getTime() + 6 * 24 * 60 * 60 * 1000),
        }
      });

      for (const day of generatedDays) {
        const mealPlanDay = await tx.mealPlanDay.create({
          data: { mealPlanId: plan.id, day: day.day, date: new Date(day.date) }
        });

        for (const meal of day.meals) {
          let recipeId = null;
          
          if (meal.recipe) {
            const recipe = await tx.recipe.create({
              data: {
                title: meal.recipe.title,
                description: meal.recipe.description,
                prepMinutes: meal.recipe.prepMinutes,
                cookMinutes: meal.recipe.cookMinutes,
                ingredients: meal.recipe.ingredients as any,
                steps: meal.recipe.instructions ? [meal.recipe.instructions] : [],
              }
            });
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
      return plan.id;
    });
  }

  async updatePlanTransaction(planId: string, recipeIds: string[], userId: string, weekStart: Date, newDays: MealPlanDayDto[]) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Delete old plan inside this transaction
      await tx.mealPlan.delete({
        where: { id: planId }
      });

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

      // 2. Create the new plan
      await this.createPlanTransaction(userId, weekStart, newDays, tx);
      
      return true;
    });
  }
}
