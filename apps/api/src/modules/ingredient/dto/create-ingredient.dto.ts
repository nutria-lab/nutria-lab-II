import { IsString, IsEnum, IsNumber, ValidateNested, IsObject, Min, IsArray, ValidateIf } from 'class-validator';
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

  @ValidateIf((_, value) => value !== undefined)
  @IsNumber()
  @Min(0)
  fiber?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsNumber()
  @Min(0)
  sodium?: number;
}

export class CreateIngredientDto {
  @IsString()
  name!: string;

  @IsEnum(IngredientType)
  type!: IngredientType;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  description?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
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
