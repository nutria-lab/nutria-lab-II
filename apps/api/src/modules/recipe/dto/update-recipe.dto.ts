import { IsString, IsNumber, ValidateNested, ArrayMinSize, IsArray, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { RecipeIngredientItemDto } from './create-recipe.dto';

export class UpdateRecipeDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  prepMinutes?: number;

  @IsNumber()
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
}
