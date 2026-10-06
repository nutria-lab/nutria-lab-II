import { IsArray, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { RecipeCategory } from '../../../generated/prisma/client';

// Body opcional de POST /meal-plans/:planId/meals/:plannedMealId/replace. Todos los campos
// refinan la búsqueda; ninguno puede relajar las restricciones del perfil.
export class ReplaceMealDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  topic?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(RecipeCategory, { each: true })
  categories?: RecipeCategory[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  properties?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPrepMinutes?: number;
}
