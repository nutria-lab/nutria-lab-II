import { IsNotEmpty } from 'class-validator';
import { IsCalendarMonday } from '../../../utils/calendar-monday.validator';

export class MealPlanQueryDto {
  @IsNotEmpty()
  @IsCalendarMonday()
  weekStart!: string;
}
