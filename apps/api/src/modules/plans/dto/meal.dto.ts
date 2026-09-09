import { IsNotEmpty, IsEnum, IsString, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MealType } from '../../../generated/prisma/client';
import { NutritionalValuesDto } from './nutritional-values.dto';
import { RecipeDto } from './recipe.dto';

export class MealDto {
  @IsNotEmpty()
  @IsEnum(MealType)
  mealType!: MealType;

  @IsNotEmpty()
  @IsString()
  title!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NutritionalValuesDto)
  nutritionalValues?: NutritionalValuesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RecipeDto)
  recipe?: RecipeDto;
}
