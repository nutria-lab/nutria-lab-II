import { IsString, IsNumber, ValidateNested, ArrayMinSize, IsArray, IsEnum, IsObject, Min, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { RecipeIngredientItemDto, RecipeNutritionalValuesDto } from './create-recipe.dto';
import { RecipeCategory } from '@/generated/prisma/client';
import { NormalizeProperties } from '@/utils/normalize-properties.util';

export class UpdateRecipeDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  title?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  description?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @IsEnum(RecipeCategory, { each: true })
  categories?: RecipeCategory[];

  @ValidateIf((_, value) => value !== undefined)
  @IsNumber()
  @Min(0)
  prepMinutes?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsNumber()
  @Min(0)
  cookMinutes?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => RecipeIngredientItemDto)
  ingredients?: RecipeIngredientItemDto[];

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  instructions?: string[];

  @ValidateIf((_, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => RecipeNutritionalValuesDto)
  nutritionalValues?: RecipeNutritionalValuesDto;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @IsString({ each: true })
  @NormalizeProperties()
  properties?: string[];
}
