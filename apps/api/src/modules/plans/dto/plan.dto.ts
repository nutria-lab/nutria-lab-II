import { IsDateString, IsNotEmpty } from 'class-validator';

export class PlanDto {
  @IsNotEmpty()
  @IsDateString()
  weekStart!: string;
}
