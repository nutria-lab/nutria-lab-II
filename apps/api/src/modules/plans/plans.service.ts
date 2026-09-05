import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MealType, DayOfWeek } from '../../generated/prisma/client';
import { GeminiService, GeneratedMealPlanDay } from './gemini.service';

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiService
  ) {}

  async generateAndPersistPlan(userId: string, weekStart: Date) {
    // Normalizar a inicio del día
    weekStart.setHours(0, 0, 0, 0);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { nutritionProfile: true },
    });

    if (!user) throw new NotFoundException('User not found');
    if (!user.nutritionProfile) throw new BadRequestException('User needs a nutrition profile');

    const existingPlan = await this.prisma.mealPlan.findUnique({
      where: { userId_startDate: { userId, startDate: weekStart } },
      include: { days: { include: { meals: { include: { recipe: true } } } } }
    });

    if (existingPlan) { // No permitimos generar dos planes para la misma semana
      throw new BadRequestException('A plan for this week already exists');
    }

    const generatedDays = await this.gemini.generateMealPlan(user.nutritionProfile, weekStart);

    this.validateGeneratedPlan(generatedDays, user.nutritionProfile);

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
    });

    // Una vez que la transacción finaliza (commit), hacemos la consulta con el cliente principal
    return this.getPlanByWeek(userId, weekStart);
  }

  async getPlanByWeek(userId: string, weekStart: Date) {
    weekStart.setHours(0, 0, 0, 0);
    const plan = await this.prisma.mealPlan.findUnique({
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

    if (!plan) throw new NotFoundException('Plan not found for this week');
    return plan;
  }

  // Funcion para validar que los planes se generen bien
  private validateGeneratedPlan(generatedDays: GeneratedMealPlanDay[], profile: any) {
    if (!generatedDays || generatedDays.length === 0) {
      throw new BadRequestException('AI returned an empty plan');
    }

    if (generatedDays.length !== 7) {
      throw new BadRequestException(`AI returned ${generatedDays.length} days instead of 7`);
    }

    const forbidden = profile.excludedIngredients.map((r: string) => r.toLowerCase());
    
    for (const day of generatedDays) {
      if (!day.meals || day.meals.length === 0) {
        throw new BadRequestException(`AI generated an empty meal list for day ${day.day}`);
      }

      for (const meal of day.meals) {
        const textToCheck = `${meal.title} ${meal.recipe?.steps.join(' ') || ''}`.toLowerCase();
        
        for (const restriction of forbidden) {
          if (textToCheck.includes(restriction)) {
            throw new BadRequestException(`AI generated a meal containing an excluded ingredient: ${restriction}`);
          }
        }
      }
    }
  }
}
