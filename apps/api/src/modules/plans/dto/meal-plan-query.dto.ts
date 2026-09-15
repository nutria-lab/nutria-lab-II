import { IsDateString, IsNotEmpty } from 'class-validator';

export class MealPlanQueryDto {
  @IsNotEmpty()
  @IsDateString()
  weekStart!: string;
}
