import { IsString, IsNumber, ValidateNested, ArrayMinSize, IsArray, IsEnum, IsObject, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { RecipeCategory } from '@/generated/prisma/client';
import { NormalizeProperties } from '@/utils/normalize-properties.util';

export class RecipeIngredientItemDto {
  @IsString()
  name!: string;

  @IsNumber()
  quantity!: number;

  @IsString()
  unit!: string;
}

export class RecipeNutritionalValuesDto {
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
}

export class CreateRecipeDto {
  @IsString()
  title!: string;

  @IsString()
  description!: string;

  @IsArray()
  @IsEnum(RecipeCategory, { each: true })
  categories!: RecipeCategory[];

  @IsNumber()
  @Min(0)
  prepMinutes!: number;

  @IsNumber()
  @Min(0)
  cookMinutes!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => RecipeIngredientItemDto)
  ingredients!: RecipeIngredientItemDto[];

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  instructions!: string[];

  @IsObject()
  @ValidateNested()
  @Type(() => RecipeNutritionalValuesDto)
  nutritionalValues!: RecipeNutritionalValuesDto;

  @IsArray()
  @IsString({ each: true })
  @NormalizeProperties()
  properties!: string[];
}
