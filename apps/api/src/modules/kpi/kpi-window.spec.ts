import {
  resolveArgentinaKpiWindow,
  selectAutomaticArgentinaKpiDate,
} from './kpi-window';

describe('Argentina KPI window', () => {
  it('maps the local [00:00, 21:00) interval to UTC without using the process timezone', () => {
    expect(resolveArgentinaKpiWindow('2026-10-09')).toEqual({
      date: '2026-10-09',
      window_start: '2026-10-09T03:00:00.000Z',
      window_end: '2026-10-10T00:00:00.000Z',
    });
  });

  it.each([
    ['2026-10-10T00:00:00.000Z', '2026-10-09'],
    ['2026-10-10T01:00:00.000Z', '2026-10-09'],
    ['2026-10-10T23:59:59.999Z', '2026-10-09'],
    ['2026-10-11T00:00:00.000Z', '2026-10-10'],
  ])('selects the last local date whose 21:00 cut-off has elapsed at %s', (now, expectedDate) => {
    expect(selectAutomaticArgentinaKpiDate({ now: () => new Date(now) })).toBe(expectedDate);
  });

  it('keeps a scheduler delayed past local midnight on the last completed cut rather than choosing today', () => {
    const delayed = { now: () => new Date('2026-10-15T04:30:00.000Z') }; // 01:30 in Argentina on Oct 15.

    expect(selectAutomaticArgentinaKpiDate(delayed)).toBe('2026-10-14');
    expect(() => resolveArgentinaKpiWindow('2026-10-15', delayed)).toThrow(/cut-off|cutoff|21:00/i);
    expect(resolveArgentinaKpiWindow('2026-10-14', delayed)).toMatchObject({
      date: '2026-10-14', window_start: '2026-10-14T03:00:00.000Z', window_end: '2026-10-15T00:00:00.000Z',
    });
  });

  it('rejects malformed, future, and not-yet-closed local dates against an injected clock', () => {
    const clock = { now: () => new Date('2026-10-10T20:59:59.999Z') };

    expect(() => resolveArgentinaKpiWindow('2026-10-10', clock)).toThrow(/cut-off|cutoff|21:00/i);
    expect(() => resolveArgentinaKpiWindow('2026-10-11', clock)).toThrow(/future/i);
    expect(() => resolveArgentinaKpiWindow('2026-2-3', clock)).toThrow(/YYYY-MM-DD/i);
    expect(() => resolveArgentinaKpiWindow('2026-02-30', clock)).toThrow(/date/i);
  });
});
