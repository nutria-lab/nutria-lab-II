import { IsCalendarMonday } from '../../../utils/calendar-monday.validator';

export class AdherenceWeekQueryDto {
  @IsCalendarMonday()
  weekStart!: string;
}
