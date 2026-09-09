import { IsNotEmpty, IsEnum, IsDateString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DayOfWeek } from '../../../generated/prisma/client';
import { MealDto } from './meal.dto';

export class MealPlanDayDto {
  @IsNotEmpty()
  @IsEnum(DayOfWeek)
  day!: DayOfWeek;

  @IsNotEmpty()
  @IsDateString()
  date!: string;

  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MealDto)
  meals!: MealDto[];
}
