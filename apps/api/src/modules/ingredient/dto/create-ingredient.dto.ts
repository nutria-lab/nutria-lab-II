import { IsString, IsEnum, IsNumber, ValidateNested, IsOptional, IsObject, Min, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { IngredientType } from '@/generated/prisma/client';
import { NormalizeProperties } from '@/utils/normalize-properties.util';

export class IngredientNutritionalValuesDto {
  @IsNumber()
  @Min(0)
  calories!: number;

  @IsNumber()
  @Min(0)
  protein!: number;

  @IsNumber()
  @Min(0)
  carbs!: number;

  @IsNumber()
  @Min(0)
  fat!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  fiber?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  sodium?: number;
}

export class CreateIngredientDto {
  @IsString()
  name!: string;

  @IsEnum(IngredientType)
  type!: IngredientType;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  defaultUnit?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => IngredientNutritionalValuesDto)
  nutritionalValues!: IngredientNutritionalValuesDto;

  @IsArray()
  @IsString({ each: true })
  @NormalizeProperties()
  properties!: string[];
}
