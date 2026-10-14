// El offset de America/Argentina/Buenos_Aires se resuelve por instante con Intl (sin -03:00 fijo).

export const KPI_TIME_ZONE = 'America/Argentina/Buenos_Aires';
export const REPORT_CUT_HOUR = 21;
export const HEALTH_BUCKET_MS = 30 * 60 * 1000;

export type KpiWindowErrorCode = 'INVALID_DATE' | 'FUTURE_CUT' | 'FUTURE_DATE';

export class KpiWindowError extends Error {
  constructor(readonly code: KpiWindowErrorCode) {
    super(code);
    this.name = 'KpiWindowError';
  }
}

export interface KpiWindow {
  // YYYY-MM-DD local de Argentina.
  date: string;
  start: Date;
  end: Date;
}

export interface PreviewWindow extends KpiWindow {
  skipReason: 'NO_POSITIVE_WINDOW' | null;
}

const REPORT_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const localPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: KPI_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(instantMs: number): LocalParts {
  const parts: Record<string, number> = {};
  for (const part of localPartsFormatter.formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

// local = utc + offset.
function zoneOffsetMs(instantMs: number): number {
  const p = localParts(instantMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

function localTimeToUtc(year: number, month: number, day: number, hour: number): Date {
  const naive = Date.UTC(year, month - 1, day, hour);
  let instant = naive - zoneOffsetMs(naive);
  const corrected = naive - zoneOffsetMs(instant);
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function splitDate(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

export function localDateOf(now: Date): string {
  const p = localParts(now.getTime());
  return formatDate(p.year, p.month, p.day);
}

function previousDate(date: string): string {
  const [y, m, d] = splitDate(date);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return formatDate(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate());
}

export function parseReportDate(raw: string): string {
  const match = REPORT_DATE_PATTERN.exec(raw);
  if (!match) throw new KpiWindowError('INVALID_DATE');
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new KpiWindowError('INVALID_DATE');
  }
  return raw;
}

export function windowForDate(date: string): KpiWindow {
  const [y, m, d] = splitDate(parseReportDate(date));
  return {
    date,
    start: localTimeToUtc(y, m, d, 0),
    end: localTimeToUtc(y, m, d, REPORT_CUT_HOUR),
  };
}

export function resolveFinalizeDate(now: Date, rawDate?: string): KpiWindow {
  if (rawDate !== undefined) {
    const window = windowForDate(parseReportDate(rawDate));
    if (window.end.getTime() > now.getTime()) throw new KpiWindowError('FUTURE_CUT');
    return window;
  }
  const today = windowForDate(localDateOf(now));
  return today.end.getTime() <= now.getTime() ? today : windowForDate(previousDate(today.date));
}

export function resolvePreviewWindow(now: Date, rawDate?: string): PreviewWindow {
  const date = rawDate !== undefined ? parseReportDate(rawDate) : localDateOf(now);
  const window = windowForDate(date);
  if (window.start.getTime() > now.getTime()) throw new KpiWindowError('FUTURE_DATE');
  const end = new Date(Math.min(now.getTime(), window.end.getTime()));
  return {
    date,
    start: window.start,
    end,
    skipReason: end.getTime() <= window.start.getTime() ? 'NO_POSITIVE_WINDOW' : null,
  };
}

export function scheduledBucket(now: Date): Date {
  return new Date(Math.floor(now.getTime() / HEALTH_BUCKET_MS) * HEALTH_BUCKET_MS);
}
