import { Injectable, BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { PlansRepository } from './plans.repository';
import { GeminiService } from './gemini/gemini.service';
import { CreateMealPlanDto, MealPlanDayDto } from './dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NutritionProfile } from '../../generated/prisma/client';

@Injectable()
export class PlansService {
  constructor(
    private readonly repository: PlansRepository,
    private readonly gemini: GeminiService
  ) {}

  private parseDateString(dateStr: string): Date {
    // Treat as UTC to avoid timezone shift
    return new Date(`${dateStr}T00:00:00Z`);
  }

  async generateAndPersistPlan(userId: string, weekStartStr: string) {
    const weekStart = this.parseDateString(weekStartStr);

    const user = await this.repository.getUserWithProfile(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.nutritionProfile) throw new BadRequestException('User needs a nutrition profile');

    const exists = await this.repository.checkPlanExists(userId, weekStart);
    if (exists) {
      // Idempotency: Return existing plan if already generated
      return this.getPlanByWeek(userId, weekStartStr);
    }

    const generatedDays = await this.gemini.generateMealPlan(user.nutritionProfile, weekStart);
    
    // Wrap in CreateMealPlanDto and validate full structure
    const dto = plainToInstance(CreateMealPlanDto, {
      weekStart: weekStartStr,
      days: generatedDays
    });

    const errors = await validate(dto);
    if (errors.length > 0) {
      // Documented recoverable failure
      throw new InternalServerErrorException('AI generated an invalid plan structure that failed domain validation');
    }

    return this.validateAndPersistPlan(userId, dto);
  }

  async validateAndPersistPlan(userId: string, dto: CreateMealPlanDto) {
    const weekStart = this.parseDateString(dto.weekStart);

    const user = await this.repository.getUserWithProfile(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.nutritionProfile) throw new BadRequestException('User needs a nutrition profile');

    const exists = await this.repository.checkPlanExists(userId, weekStart);
    if (exists) throw new BadRequestException('A plan for this week already exists');

    this.validateRestrictions(dto.days, user.nutritionProfile);

    await this.repository.createPlanTransaction(userId, weekStart, dto.days);
    return this.getPlanByWeek(userId, dto.weekStart);
  }

  async deletePlan(userId: string, weekStartStr: string){
    const weekStart = this.parseDateString(weekStartStr);
    const plan = await this.getPlanByWeek(userId, weekStartStr);

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

  async updatePlan(userId: string, dto: CreateMealPlanDto) {
    const weekStart = this.parseDateString(dto.weekStart);

    const user = await this.repository.getUserWithProfile(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.nutritionProfile) throw new BadRequestException('User needs a nutrition profile');

    const plan = await this.repository.findPlanByWeek(userId, weekStart);
    if (!plan) throw new NotFoundException('Plan not found to update');

    this.validateRestrictions(dto.days, user.nutritionProfile);

    const recipeIds: string[] = [];
    for (const day of plan.days || []) {
      for (const meal of day.meals || []) {
        if (meal.recipeId) {
          recipeIds.push(meal.recipeId);
        }
      }
    }

    await this.repository.updatePlanTransaction(plan.id, recipeIds, userId, weekStart, dto.days);

    return this.getPlanByWeek(userId, dto.weekStart);
  }

  async getPlanByWeek(userId: string, weekStartStr: string) {
    const weekStart = this.parseDateString(weekStartStr);
    const plan = await this.repository.findPlanByWeek(userId, weekStart);

    if (!plan) throw new NotFoundException('Plan not found for this week');
    return plan;
  }

  private validateRestrictions(days: MealPlanDayDto[], profile: NutritionProfile) {
    if (!days || days.length !== 7) {
      throw new BadRequestException(`Plan must have exactly 7 days`);
    }

    const excluded = Array.isArray(profile.excludedIngredients) 
      ? profile.excludedIngredients 
      : [];
    const forbidden = excluded.map(String).map(r => r.toLowerCase());

    for (const day of days) {
      if (!day.meals || day.meals.length === 0) {
        throw new BadRequestException(`Empty meal list for day ${day.day}`);
      }

      for (const meal of day.meals) {
        // Usamos los nombres de ingredientes estructurados para validar restricciones
        const ingredientNames = meal.recipe?.ingredients?.map(i => i.name) || [];
        const textParts = [
          meal.title,
          meal.nutritionalValues?.Description || '',
          ...ingredientNames
        ];
        
        const textToCheck = textParts.join(' ').toLowerCase();
        
        for (const restriction of forbidden) {
          // Check for exact word matches or close substrings
          const regex = new RegExp(`\\b${restriction}\\b`, 'i');
          if (regex.test(textToCheck) || textToCheck.includes(restriction)) {
            throw new BadRequestException(`Meal '${meal.title}' contains excluded ingredient/concept: ${restriction}`);
          }
        }
      }
    }
  }
}
