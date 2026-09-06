import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PlansRepository } from './plans.repository';
import { GeminiService, GeneratedMealPlanDay } from './gemini.service';
import { DayOfWeek, MealType } from '../../generated/prisma/client';

@Injectable()
export class PlansService {
  constructor(
    private readonly repository: PlansRepository,
    private readonly gemini: GeminiService
  ) {}

  async generateAndPersistPlan(userId: string, weekStart: Date) {
    weekStart.setHours(0, 0, 0, 0);

    const user = await this.repository.getUserWithProfile(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.nutritionProfile) throw new BadRequestException('User needs a nutrition profile');

    const exists = await this.repository.checkPlanExists(userId, weekStart);
    if (exists) throw new BadRequestException('A plan for this week already exists');

    const generatedDays = await this.gemini.generateMealPlan(user.nutritionProfile, weekStart);
    this.validateGeneratedPlan(generatedDays, user.nutritionProfile);

    await this.repository.createPlanTransaction(userId, weekStart, generatedDays);
    return this.getPlanByWeek(userId, weekStart);
  }

  async generateAndPersistPredefinedPlan(userId: string, weekStart: Date) {
    // Normalizar a inicio del día
    weekStart.setHours(0, 0, 0, 0);

    const exists = await this.repository.checkPlanExists(userId, weekStart);
    if (exists) throw new BadRequestException('A plan for this week already exists');

    const predefinedDays = this.getPredefinedTemplate(weekStart);

    await this.repository.createPlanTransaction(userId, weekStart, predefinedDays);
    return this.getPlanByWeek(userId, weekStart);
  }

  async deletePlan(userId: string, weekStart: Date){
    const plan = await this.getPlanByWeek(userId, weekStart);

    // Lógica de negocio: Identificamos todas las recetas que quedarán huérfanas
    const recipeIds: string[] = [];
    for (const day of plan.days || []) {
      for (const meal of day.meals || []) {
        if (meal.recipeId) {
          recipeIds.push(meal.recipeId);
        }
      }
    }

    return this.repository.deletePlanTransaction(plan.id, recipeIds);
  }

  async updatePlan(userId: string, weekStart: Date) {
    // Normalizar
    weekStart.setHours(0, 0, 0, 0);

    const user = await this.repository.getUserWithProfile(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.nutritionProfile) throw new BadRequestException('User needs a nutrition profile');

    const plan = await this.repository.findPlanByWeek(userId, weekStart);
    if (!plan) throw new NotFoundException('Plan not found to update');

    // Generar el plan con Gemini de nuevo
    const generatedDays = await this.gemini.generateMealPlan(user.nutritionProfile, weekStart);
    this.validateGeneratedPlan(generatedDays, user.nutritionProfile);

    await this.deletePlan(userId, weekStart);

    await this.repository.createPlanTransaction(userId, weekStart, generatedDays);

    return this.getPlanByWeek(userId, weekStart);
  }

  async getPlanByWeek(userId: string, weekStart: Date) {
    weekStart.setHours(0, 0, 0, 0);
    const plan = await this.repository.findPlanByWeek(userId, weekStart);

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

  private getPredefinedTemplate(weekStart: Date): GeneratedMealPlanDay[] {
    const days: DayOfWeek[] = [
      DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, 
      DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY, DayOfWeek.SUNDAY
    ];
    
    return days.map((dayName, index) => {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + index);

      return {
        day: dayName,
        date: date.toISOString().split('T')[0],
        meals: [
          {
            mealType: MealType.BREAKFAST,
            title: 'Avena Clásica',
            nutritionalValues: { Protein: 10, Fiber: 5, Calories: 300, Description: 'Avena con leche y miel' },
          },
          {
            mealType: MealType.LUNCH,
            title: 'Pollo con Arroz',
            nutritionalValues: { Protein: 30, Fiber: 2, Calories: 500, Description: 'Pechuga a la plancha' },
          },
          {
            mealType: MealType.DINNER,
            title: 'Ensalada Mixta',
            nutritionalValues: { Protein: 10, Fiber: 8, Calories: 250, Description: 'Vegetales frescos' },
          }
        ]
      };
    });
  }
}
