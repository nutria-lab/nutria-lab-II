export const PRODUCT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function getBuenosAiresCalendarDate(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PRODUCT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value);

  return new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
}

function toDateKey(calendarDate: Date): string {
  return `${calendarDate.getUTCFullYear()}-${pad(calendarDate.getUTCMonth() + 1)}-${pad(calendarDate.getUTCDate())}`;
}

/** Returns today's calendar date in the product timezone. */
export function getCurrentDateInBuenosAires(now = new Date()): string {
  return toDateKey(getBuenosAiresCalendarDate(now));
}

/** Returns the Monday calendar date for the current week in the product timezone. */
export function getCurrentWeekStartInBuenosAires(now = new Date()): string {
  const calendarDate = getBuenosAiresCalendarDate(now);
  const daysSinceMonday = (calendarDate.getUTCDay() + 6) % 7;
  calendarDate.setUTCDate(calendarDate.getUTCDate() - daysSinceMonday);

  return toDateKey(calendarDate);
}
