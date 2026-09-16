import { IsString, IsNumber, ValidateNested, ArrayMinSize, IsArray, IsOptional, IsEnum, IsObject, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { RecipeIngredientItemDto, RecipeNutritionalValuesDto } from './create-recipe.dto';
import { RecipeCategory } from '@/generated/prisma/client';
import { NormalizeProperties } from '@/utils/normalize-properties.util';

export class UpdateRecipeDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsEnum(RecipeCategory, { each: true })
  @IsOptional()
  categories?: RecipeCategory[];

  @IsNumber()
  @Min(0)
  @IsOptional()
  prepMinutes?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  cookMinutes?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => RecipeIngredientItemDto)
  @IsOptional()
  ingredients?: RecipeIngredientItemDto[];

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @IsOptional()
  instructions?: string[];

  @IsObject()
  @ValidateNested()
  @Type(() => RecipeNutritionalValuesDto)
  @IsOptional()
  nutritionalValues?: RecipeNutritionalValuesDto;

  @IsArray()
  @IsString({ each: true })
  @NormalizeProperties()
  @IsOptional()
  properties?: string[];
}
