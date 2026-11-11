// "Hoy" y la semana del producto se deciden en Buenos Aires (contrato A), nunca con la zona del navegador.
export const PRODUCT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

const CALENDAR_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: PRODUCT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DAY_MS = 24 * 60 * 60 * 1000;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Fecha calendario real `YYYY-MM-DD` (rechaza, por ejemplo, 2026-02-30).
export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function getBuenosAiresToday(now: Date = new Date()): string {
  return CALENDAR_DATE_FORMAT.format(now);
}

// Aritmética sobre la fecha calendario en UTC: el resultado no depende de la zona del navegador.
export function getWeekStart(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`);
  const daysSinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - daysSinceMonday * DAY_MS).toISOString().slice(0, 10);
}

// Último día (domingo) de la semana que empieza en `weekStart`.
export function getWeekEnd(weekStart: string): string {
  return new Date(new Date(`${weekStart}T00:00:00.000Z`).getTime() + 6 * DAY_MS).toISOString().slice(0, 10);
}

export function getCurrentWeekStart(now: Date = new Date()): string {
  return getWeekStart(getBuenosAiresToday(now));
}
