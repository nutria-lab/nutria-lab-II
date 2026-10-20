import { Matches, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'isCalendarMonday', async: false })
class IsCalendarMondayConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);

    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day
      && date.getUTCDay() === 1;
  }

  defaultMessage(): string {
    return 'weekStart must be a real calendar date in YYYY-MM-DD format and a Monday';
  }
}

export class ShoppingListQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @Validate(IsCalendarMondayConstraint)
  weekStart!: string;
}
