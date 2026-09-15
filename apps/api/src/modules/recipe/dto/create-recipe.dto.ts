import { IsString, IsNumber, ValidateNested, ArrayMinSize, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export class RecipeIngredientItemDto {
  @IsString()
  name!: string;

  @IsNumber()
  quantity!: number;

  @IsString()
  unit!: string;
}

export class CreateRecipeDto {
  @IsString()
  title!: string;

  @IsString()
  description!: string;

  @IsNumber()
  prepMinutes!: number;

  @IsNumber()
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
}
