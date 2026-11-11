import { IsNotEmpty, IsArray, ValidateNested, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { IsCalendarMonday } from '../../../utils/calendar-monday.validator';
import { MealPlanDayDto } from './meal-plan-day.dto';

export class CreateMealPlanDto {
  @IsNotEmpty()
  @IsCalendarMonday()
  weekStart!: string;

  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => MealPlanDayDto)
  days!: MealPlanDayDto[];
}
