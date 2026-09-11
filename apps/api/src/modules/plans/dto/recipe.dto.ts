import { IsString, IsNumber, IsArray, IsNotEmpty, ValidateNested, Min, ArrayMinSize } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class IngredientDto {
  @IsNotEmpty()
  @IsString()
  name!: string;

  // El contrato acepta número o string porque Gemini puede devolver "1/2" o 0.5.
  // El campo NO se normaliza a un tipo fijo para no perder información.
  @IsNotEmpty()
  quantity!: number | string;

  @IsNotEmpty()
  @IsString()
  unit!: string;
}

export class RecipeDto {
  @IsNotEmpty()
  @IsString()
  title!: string;

  @IsNotEmpty()
  @IsString()
  description!: string;

  @IsNumber()
  @Min(0)
  prepMinutes!: number;

  @IsNumber()
  @Min(0)
  cookMinutes!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => IngredientDto)
  ingredients!: IngredientDto[];

  @Transform(({ value }) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      return [value.trim()];
    }
    return value;
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  instructions!: string[];
}
