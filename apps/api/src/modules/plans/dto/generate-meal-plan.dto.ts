import { IsDateString, IsNotEmpty } from 'class-validator';

export class GenerateMealPlanDto {
  @IsNotEmpty()
  @IsDateString()
  weekStart!: string;
}
