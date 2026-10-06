import { IsString, IsNumber, IsArray, IsNotEmpty, ValidateNested, Min, ArrayMinSize, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class IngredientDto {
  @IsNotEmpty()
  @IsString()
  name!: string;

  // El contrato acepta número o string porque Gemini puede devolver "1/2" o 0.5.
  // El campo NO se normaliza a un tipo fijo para no perder información.
  // null: ingrediente sin cantidad ("al gusto") que NUT-74 guarda así; un PUT tiene que poder reenviarlo.
  @ValidateIf((_, value) => value !== null)
  @IsNotEmpty()
  quantity!: number | string | null;

  @IsNotEmpty()
  @IsString()
  unit!: string;
}

export class RecipeDto {
  // Sólo se usa en PUT /meal-plans: si es el id de una receta de la versión actual del plan del
  // mismo usuario, esa receta conserva su imagen. Cualquier otro id se trata como receta nueva.
  @IsOptional()
  @IsUUID()
  id?: string;

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
