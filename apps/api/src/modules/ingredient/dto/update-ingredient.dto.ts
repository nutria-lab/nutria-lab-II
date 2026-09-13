import { IsString, IsEnum, ValidateNested, IsOptional, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { IngredientType } from '@/generated/prisma/client';
import { IngredientNutritionalValuesDto } from './create-ingredient.dto';

export class UpdateIngredientDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(IngredientType)
  @IsOptional()
  type?: IngredientType;

  @IsObject()
  @ValidateNested()
  @Type(() => IngredientNutritionalValuesDto)
  @IsOptional()
  nutritionalValues?: IngredientNutritionalValuesDto;
}
