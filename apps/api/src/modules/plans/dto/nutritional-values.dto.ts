import { IsNumber, IsNotEmpty, IsString, Min } from 'class-validator';

export class NutritionalValuesDto {
  @IsNumber()
  @Min(0)
  Protein!: number;

  @IsNumber()
  @Min(0)
  Fiber!: number;

  @IsNumber()
  @Min(0)
  Calories!: number;

  @IsNotEmpty()
  @IsString()
  Description!: string;
}
