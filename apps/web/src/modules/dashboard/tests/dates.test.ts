import { describe, expect, it } from 'vitest';

import { getBuenosAiresToday, getCurrentWeekStart, getWeekEnd, getWeekStart, isCalendarDate } from '../dates';

describe('getBuenosAiresToday', () => {
  it('uses Buenos Aires (UTC-3), not UTC: 02:30 UTC on Monday is still Sunday', () => {
    expect(getBuenosAiresToday(new Date('2026-10-26T02:30:00.000Z'))).toBe('2026-10-25');
  });

  it('03:30 UTC on Monday is Monday in Buenos Aires', () => {
    expect(getBuenosAiresToday(new Date('2026-10-26T03:30:00.000Z'))).toBe('2026-10-26');
  });
});

describe('getWeekStart', () => {
  it.each([
    ['2026-10-19', '2026-10-19'],
    ['2026-10-21', '2026-10-19'],
    ['2026-10-25', '2026-10-19'],
    ['2026-11-01', '2026-10-26'],
    ['2027-01-01', '2026-12-28'],
  ])('%s → Monday %s', (date, monday) => {
    expect(getWeekStart(date)).toBe(monday);
  });
});

describe('getWeekEnd', () => {
  it('returns the Sunday, across month and year boundaries', () => {
    expect(getWeekEnd('2026-10-19')).toBe('2026-10-25');
    expect(getWeekEnd('2026-12-28')).toBe('2027-01-03');
  });
});

describe('isCalendarDate', () => {
  it.each([
    ['2026-10-19', true],
    ['2026-02-30', false],
    ['2026-10-19T00:00:00.000Z', false],
    ['19/10/2026', false],
    ['', false],
  ])('%s → %s', (value, expected) => {
    expect(isCalendarDate(value)).toBe(expected);
  });
});

describe('getCurrentWeekStart', () => {
  it('Sunday 23:30 in Buenos Aires belongs to the week that started the previous Monday', () => {
    expect(getCurrentWeekStart(new Date('2026-10-26T02:30:00.000Z'))).toBe('2026-10-19');
  });

  it('Monday 00:30 in Buenos Aires starts a new week', () => {
    expect(getCurrentWeekStart(new Date('2026-10-26T03:30:00.000Z'))).toBe('2026-10-26');
  });
});
