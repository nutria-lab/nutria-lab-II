import { describe, expect, it } from 'vitest';
import {
  formatDayAbbreviation,
  formatDayNumber,
  formatFullDate,
  formatWeekRange,
  parseLocalDate,
} from './utils';
import type { MealPlanDay } from '../../services/mealPlanService';

// NUT-10 (tercera iteración) — hallazgo BLOQUEANTE de los reviewers: el backend real de
// NUT-6 devuelve `MealPlanDay.date` como datetime ISO completo (`DateTime` de Prisma sin
// `@db.Date`, ver apps/api/prisma/models/mealPlanDay.prisma), ej. '2026-09-14T00:00:00.000Z',
// no 'YYYY-MM-DD'. `parseLocalDate` (utils.ts líneas 30-33) hoy asume 'YYYY-MM-DD' y hace
// `Number("14T00:00:00.000Z")` → NaN al recibir el formato real, produciendo `Invalid Date`
// y, en cascada, un `TypeError` en `formatFullDate` (`.charAt(0)` sobre `undefined`).
//
// Estos tests deben fallar HOY contra `utils.ts` sin modificar, y seguir pasando con el
// formato viejo 'YYYY-MM-DD' (no-regresión).

function buildDay(date: string): MealPlanDay {
  return { id: `day-${date}`, mealPlanId: 'plan-1', day: 'MONDAY', date, meals: [] };
}

describe('parseLocalDate', () => {
  it('parses the plain YYYY-MM-DD form as the expected local date (non-regression)', () => {
    const date = parseLocalDate('2026-09-14');

    expect(Number.isNaN(date.getTime())).toBe(false);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(8);
    expect(date.getDate()).toBe(14);
  });

  it('parses a full ISO datetime string as the same local date as the plain form, without producing Invalid Date', () => {
    const fromIso = parseLocalDate('2026-09-14T00:00:00.000Z');
    const fromPlain = parseLocalDate('2026-09-14');

    expect(Number.isNaN(fromIso.getTime())).toBe(false);
    expect(fromIso.getFullYear()).toBe(2026);
    expect(fromIso.getMonth()).toBe(8);
    expect(fromIso.getDate()).toBe(14);
    expect(fromIso.getTime()).toBe(fromPlain.getTime());
  });
});

describe('formatFullDate', () => {
  it('formats the plain YYYY-MM-DD form correctly (non-regression)', () => {
    // 2026-09-14 es lunes (confirmado contra la fecha de hoy y contra el fixture real
    // de plan.md, donde 2026-08-24 es lunes y 2026-09-14 cae exactamente 3 semanas después).
    expect(formatFullDate('2026-09-14')).toBe('Lunes, 14 de septiembre');
  });

  it('formats a full ISO datetime string without throwing and with the same result as the plain form', () => {
    expect(() => formatFullDate('2026-09-14T00:00:00.000Z')).not.toThrow();
    expect(formatFullDate('2026-09-14T00:00:00.000Z')).toBe(formatFullDate('2026-09-14'));
    expect(formatFullDate('2026-09-14T00:00:00.000Z')).toBe('Lunes, 14 de septiembre');
  });
});

describe('formatDayNumber', () => {
  it('returns the day number for the plain YYYY-MM-DD form (non-regression)', () => {
    expect(formatDayNumber('2026-09-14')).toBe('14');
  });

  it('returns the day number for a full ISO datetime string, not NaN', () => {
    expect(formatDayNumber('2026-09-14T00:00:00.000Z')).toBe('14');
  });
});

describe('formatDayAbbreviation', () => {
  it('returns the weekday abbreviation for the plain YYYY-MM-DD form (non-regression)', () => {
    expect(formatDayAbbreviation('2026-09-14')).toBe('LUN');
  });

  it('returns the weekday abbreviation for a full ISO datetime string, not undefined', () => {
    expect(formatDayAbbreviation('2026-09-14T00:00:00.000Z')).toBe('LUN');
  });
});

describe('formatWeekRange', () => {
  it('formats the range for days using the plain YYYY-MM-DD form (non-regression)', () => {
    const days = [buildDay('2026-09-14'), buildDay('2026-09-20')];

    expect(formatWeekRange(days)).toBe('14 – 20 de septiembre, 2026');
  });

  it('formats the range correctly for days using full ISO datetime dates, instead of "NaN de undefined..."', () => {
    const days = [buildDay('2026-09-14T00:00:00.000Z'), buildDay('2026-09-20T00:00:00.000Z')];

    const result = formatWeekRange(days);

    expect(result).not.toContain('NaN');
    expect(result).not.toContain('undefined');
    expect(result).toBe('14 – 20 de septiembre, 2026');
  });
});

// NUT-10 (séptima iteración) — Hallazgo A (Alto, resiliencia) de la segunda vuelta de
// reviewers: `mealPlanService.ts` normaliza `date` con `.slice(0, 10)` pero no valida el
// formato. Si `date` llegara vacío o malformado, `parseLocalDate` produce un `Date` inválido
// (`getTime()` es `NaN`), y hoy `formatFullDate` explota con
// `TypeError: Cannot read properties of undefined (reading 'charAt')` al indexar
// `WEEKDAY_NAMES[NaN]` (`undefined`) y llamarle `.charAt(0)`. Como la app no tiene ningún
// `ErrorBoundary`, esto tumbaría toda la UI, no solo el plan de comidas.
//
// La corrección esperada (a cargo del implementer): `formatFullDate`, `formatDayAbbreviation`,
// `formatDayNumber` y `formatWeekRange` deben detectar un `Date` inválido
// (`Number.isNaN(date.getTime())`) y devolver `''` en vez de intentar formatear. Estos tests
// deben fallar HOY (roja: `formatFullDate('')`/`formatFullDate('no-es-una-fecha')` tiran
// `TypeError` en vez de devolver `''`) y pasar una vez aplicada la corrección.
//
// Strings de fecha inválida usados a propósito para cubrir dos formas distintas de llegar a
// `Invalid Date` desde `parseLocalDate`: `''` (los tres componentes year/month/day quedan
// `NaN` porque `''.split('-')` da `['']` y `Number('')` es `NaN`) y `'no-es-una-fecha'` (mismo
// resultado, pero simulando un valor no vacío y claramente no numérico, no solo un string
// vacío/falsy).
describe('invalid date handling (NUT-10 hallazgo A, séptima iteración)', () => {
  it('formatFullDate returns an empty string for an empty date string, without throwing', () => {
    expect(() => formatFullDate('')).not.toThrow();
    expect(formatFullDate('')).toBe('');
  });

  it('formatFullDate returns an empty string for a malformed (non-date) string, without throwing', () => {
    expect(() => formatFullDate('no-es-una-fecha')).not.toThrow();
    expect(formatFullDate('no-es-una-fecha')).toBe('');
  });

  it('formatDayAbbreviation returns an empty string for an empty date string, without throwing', () => {
    expect(() => formatDayAbbreviation('')).not.toThrow();
    expect(formatDayAbbreviation('')).toBe('');
  });

  it('formatDayAbbreviation returns an empty string for a malformed (non-date) string, without throwing', () => {
    expect(() => formatDayAbbreviation('no-es-una-fecha')).not.toThrow();
    expect(formatDayAbbreviation('no-es-una-fecha')).toBe('');
  });

  it('formatDayNumber returns an empty string for an empty date string, without throwing', () => {
    expect(() => formatDayNumber('')).not.toThrow();
    expect(formatDayNumber('')).toBe('');
  });

  it('formatDayNumber returns an empty string for a malformed (non-date) string, without throwing', () => {
    expect(() => formatDayNumber('no-es-una-fecha')).not.toThrow();
    expect(formatDayNumber('no-es-una-fecha')).toBe('');
  });

  it('formatWeekRange returns an empty string (not a string containing NaN/undefined) when the FIRST day has an invalid date, without throwing', () => {
    const days = [buildDay('no-es-una-fecha'), buildDay('2026-09-20')];

    expect(() => formatWeekRange(days)).not.toThrow();
    const result = formatWeekRange(days);
    expect(result).toBe('');
    expect(result).not.toContain('NaN');
    expect(result).not.toContain('undefined');
  });

  it('formatWeekRange returns an empty string (not a string containing NaN/undefined) when the LAST day has an invalid date, without throwing', () => {
    const days = [buildDay('2026-09-14'), buildDay('')];

    expect(() => formatWeekRange(days)).not.toThrow();
    const result = formatWeekRange(days);
    expect(result).toBe('');
    expect(result).not.toContain('NaN');
    expect(result).not.toContain('undefined');
  });

  // No-regresión: la guarda contra fechas inválidas no debe alterar el formateo de fechas
  // válidas, ni en la forma corta 'YYYY-MM-DD' ni en la forma ISO completa que devuelve el
  // backend real.
  it('non-regression: valid dates (plain YYYY-MM-DD and full ISO) keep formatting exactly as before', () => {
    expect(formatFullDate('2026-09-14')).toBe('Lunes, 14 de septiembre');
    expect(formatFullDate('2026-09-14T00:00:00.000Z')).toBe('Lunes, 14 de septiembre');
    expect(formatDayAbbreviation('2026-09-14')).toBe('LUN');
    expect(formatDayAbbreviation('2026-09-14T00:00:00.000Z')).toBe('LUN');
    expect(formatDayNumber('2026-09-14')).toBe('14');
    expect(formatDayNumber('2026-09-14T00:00:00.000Z')).toBe('14');
    expect(formatWeekRange([buildDay('2026-09-14'), buildDay('2026-09-20')])).toBe(
      '14 – 20 de septiembre, 2026',
    );
    expect(
      formatWeekRange([
        buildDay('2026-09-14T00:00:00.000Z'),
        buildDay('2026-09-20T00:00:00.000Z'),
      ]),
    ).toBe('14 – 20 de septiembre, 2026');
  });
});
