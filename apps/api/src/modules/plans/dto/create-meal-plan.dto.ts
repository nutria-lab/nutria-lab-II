import { IsNotEmpty, IsDateString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MealPlanDayDto } from './meal-plan-day.dto';

export class CreateMealPlanDto {
  @IsNotEmpty()
  @IsDateString()
  weekStart!: string;

  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MealPlanDayDto)
  days!: MealPlanDayDto[];
}
