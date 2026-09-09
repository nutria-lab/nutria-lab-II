import { IsNumber, IsOptional, IsArray, IsString } from 'class-validator';

export class RecipeDto {
  @IsOptional()
  @IsNumber()
  prepMinutes?: number;

  @IsOptional()
  @IsNumber()
  cookMinutes?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  steps?: string[];
}
