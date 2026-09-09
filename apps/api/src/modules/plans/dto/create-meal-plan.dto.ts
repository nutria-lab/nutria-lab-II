import { IsNotEmpty, IsDateString, IsArray, ValidateNested, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { MealPlanDayDto } from './meal-plan-day.dto';

export class CreateMealPlanDto {
  @IsNotEmpty()
  @IsDateString()
  weekStart!: string;

  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => MealPlanDayDto)
  days!: MealPlanDayDto[];
}
