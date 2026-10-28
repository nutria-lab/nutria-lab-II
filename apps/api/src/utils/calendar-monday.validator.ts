import {
  registerDecorator,
  type ValidationOptions,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Validates an exact YYYY-MM-DD calendar date whose weekday is Monday.
 * The date components are interpreted in UTC calendar arithmetic and never
 * parsed as a local timestamp.
 */
export function isCalendarMonday(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCDay() === 1;
}

@ValidatorConstraint({ name: 'isCalendarMonday', async: false })
class CalendarMondayConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isCalendarMonday(value);
  }

  defaultMessage(): string {
    return 'weekStart must be a real calendar date in YYYY-MM-DD format and a Monday';
  }
}

export function IsCalendarMonday(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    registerDecorator({
      name: 'isCalendarMonday',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      options: validationOptions,
      validator: CalendarMondayConstraint,
    });
  };
}
