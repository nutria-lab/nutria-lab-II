import { isCalendarMonday } from './calendar-monday.validator';

describe('isCalendarMonday', () => {
  it.each([
    ['an exact calendar Monday', '2026-10-19', true],
    ['a known NUT-92 Monday', '2026-02-02', true],
    ['a real Tuesday', '2026-10-20', false],
    ['an impossible calendar date', '2026-02-30', false],
    ['a malformed date', '2026-1-19', false],
    ['a timestamp instead of a calendar date', '2026-10-19T00:00:00.000Z', false],
    ['an empty value', '', false],
  ])('returns %s = %s', (_description, value, expected) => {
    expect(isCalendarMonday(value)).toBe(expected);
  });

  it('interprets the same calendar date consistently across process timezones', () => {
    const originalTimezone = process.env.TZ;

    try {
      process.env.TZ = 'America/Los_Angeles';
      const losAngelesResult = isCalendarMonday('2026-10-19');

      process.env.TZ = 'Pacific/Auckland';
      const aucklandResult = isCalendarMonday('2026-10-19');

      expect(losAngelesResult).toBe(true);
      expect(aucklandResult).toBe(true);
      expect(losAngelesResult).toBe(aucklandResult);
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });
});
