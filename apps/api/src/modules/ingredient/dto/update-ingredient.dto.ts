import { IsString, IsEnum, ValidateNested, IsObject, IsArray, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { IngredientType } from '@/generated/prisma/client';
import { IngredientNutritionalValuesDto } from './create-ingredient.dto';
import { NormalizeProperties } from '@/utils/normalize-properties.util';

export class UpdateIngredientDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  name?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(IngredientType)
  type?: IngredientType;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  description?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  defaultUnit?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => IngredientNutritionalValuesDto)
  nutritionalValues?: IngredientNutritionalValuesDto;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @IsString({ each: true })
  @NormalizeProperties()
  properties?: string[];
}
