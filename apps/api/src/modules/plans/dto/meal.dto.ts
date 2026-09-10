import { IsNotEmpty, IsEnum, IsString, ValidateNested } from 'class-validator';
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

  // nutritionalValues es obligatorio: una comida sin macros no es un dato válido.
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => NutritionalValuesDto)
  nutritionalValues!: NutritionalValuesDto;

  // recipe es obligatorio: cada comida en el contrato incluye receta.
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => RecipeDto)
  recipe!: RecipeDto;
}
