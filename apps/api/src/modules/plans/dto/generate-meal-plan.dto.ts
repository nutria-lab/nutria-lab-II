import { IsNotEmpty } from 'class-validator';
import { IsCalendarMonday } from '../../../utils/calendar-monday.validator';

export class GenerateMealPlanDto {
  @IsNotEmpty()
  @IsCalendarMonday()
  weekStart!: string;
}
