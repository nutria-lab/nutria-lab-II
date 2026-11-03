import { IsCalendarMonday } from '../../../utils/calendar-monday.validator';

export class ShoppingListQueryDto {
  @IsCalendarMonday()
  weekStart!: string;
}
