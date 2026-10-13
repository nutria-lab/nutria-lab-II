export interface Clock {
  now(): Date;
}

export interface ArgentinaKpiWindow {
  date: string;
  window_start: string;
  window_end: string;
}

const ARGENTINA_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const systemClock: Clock = { now: () => new Date() };

/**
 * Resolves the local Argentina collection period [00:00, 21:00) as UTC.
 * Argentina has no DST, so the UTC-03:00 offset is intentionally explicit.
 */
export function resolveArgentinaKpiWindow(
  date: string,
  clock: Clock = systemClock,
): ArgentinaKpiWindow {
  const parsed = parseLocalDate(date);
  const windowStart = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day) + ARGENTINA_UTC_OFFSET_MS);
  const windowEnd = new Date(windowStart.getTime() + 21 * 60 * 60 * 1000);
  const now = clock.now();

  if (windowStart.getTime() > now.getTime()) {
    throw new Error(`KPI date ${date} is in the future`);
  }
  if (windowEnd.getTime() > now.getTime()) {
    throw new Error(`KPI date ${date} has not reached its 21:00 cut-off`);
  }

  return {
    date,
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
  };
}

/** Selects the last Argentina local date whose 21:00 collection cut-off elapsed. */
export function selectAutomaticArgentinaKpiDate(clock: Clock = systemClock): string {
  const now = clock.now();
  const argentinaNow = new Date(now.getTime() - ARGENTINA_UTC_OFFSET_MS);
  const localDate = formatUtcDate(argentinaNow);
  const candidate = windowForDate(localDate);

  if (now.getTime() >= candidate.windowEnd.getTime()) {
    return localDate;
  }

  return formatUtcDate(new Date(Date.UTC(
    argentinaNow.getUTCFullYear(),
    argentinaNow.getUTCMonth(),
    argentinaNow.getUTCDate() - 1,
  )));
}

function windowForDate(date: string): { windowStart: Date; windowEnd: Date } {
  const parsed = parseLocalDate(date);
  const windowStart = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day) + ARGENTINA_UTC_OFFSET_MS);
  return { windowStart, windowEnd: new Date(windowStart.getTime() + 21 * 60 * 60 * 1000) };
}

function parseLocalDate(value: string): { year: number; month: number; day: number } {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    throw new Error('KPI date must use YYYY-MM-DD');
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  if (
    asUtc.getUTCFullYear() !== year ||
    asUtc.getUTCMonth() !== month - 1 ||
    asUtc.getUTCDate() !== day
  ) {
    throw new Error(`Invalid KPI date: ${value}`);
  }
  return { year, month, day };
}

function formatUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
