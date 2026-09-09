import { IsNumber, IsOptional, IsString } from 'class-validator';

export class NutritionalValuesDto {
  @IsOptional()
  @IsNumber()
  Protein?: number;

  @IsOptional()
  @IsNumber()
  Fiber?: number;

  @IsOptional()
  @IsNumber()
  Calories?: number;

  @IsOptional()
  @IsString()
  Description?: string;
}
