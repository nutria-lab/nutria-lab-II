import { IsNotEmpty, IsEnum, IsDateString, IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
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
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MealDto)
  meals!: MealDto[];
}
