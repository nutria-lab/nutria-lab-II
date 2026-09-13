import { IsString, IsEnum, IsNumber, ValidateNested, IsOptional, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { IngredientType } from '@/generated/prisma/client';

export class IngredientNutritionalValuesDto {
  @IsNumber()
  calories!: number;

  @IsNumber()
  protein!: number;

  @IsNumber()
  carbs!: number;

  @IsNumber()
  fat!: number;

  @IsNumber()
  @IsOptional()
  fiber?: number;
}

export class CreateIngredientDto {
  @IsString()
  name!: string;

  @IsEnum(IngredientType)
  type!: IngredientType;

  @IsObject()
  @ValidateNested()
  @Type(() => IngredientNutritionalValuesDto)
  nutritionalValues!: IngredientNutritionalValuesDto;
}
