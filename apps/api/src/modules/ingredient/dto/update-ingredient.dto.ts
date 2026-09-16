import { IsString, IsEnum, ValidateNested, IsOptional, IsObject, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { IngredientType } from '@/generated/prisma/client';
import { IngredientNutritionalValuesDto } from './create-ingredient.dto';
import { NormalizeProperties } from '@/utils/normalize-properties.util';

export class UpdateIngredientDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(IngredientType)
  @IsOptional()
  type?: IngredientType;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  defaultUnit?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => IngredientNutritionalValuesDto)
  @IsOptional()
  nutritionalValues?: IngredientNutritionalValuesDto;

  @IsArray()
  @IsString({ each: true })
  @NormalizeProperties()
  @IsOptional()
  properties?: string[];
}
