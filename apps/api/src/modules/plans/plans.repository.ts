import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GeneratedMealPlanDay } from './gemini.service';
import { MealPlan } from '../../generated/prisma/client';

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
        await tx.recipe.deleteMany({
          where: { id: { in: recipeIds } }
        });
      }

      return deletedPlan;
    });
  }

  async createPlanTransaction(userId: string, weekStart: Date, generatedDays: GeneratedMealPlanDay[]) {
    return this.prisma.$transaction(async (tx) => {
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
                prepMinutes: meal.recipe.prepMinutes || 0,
                cookMinutes: meal.recipe.cookMinutes || 0,
                steps: meal.recipe.steps || [],
              }
            });
            recipeId = recipe.id;
          }

          await tx.plannedMeal.create({
            data: {
              dayId: mealPlanDay.id,
              mealType: meal.mealType,
              title: meal.title,
              nutritionalValues: meal.nutritionalValues || {},
              recipeId,
            }
          });
        }
      }
      return plan.id;
    });
  }
}
