import { describe, expect, it } from 'vitest';
import { getCurrentDateInBuenosAires, getCurrentWeekStartInBuenosAires } from '../calendar';

describe('getCurrentDateInBuenosAires', () => {
  it('uses the Buenos Aires calendar date around midnight', () => {
    expect(getCurrentDateInBuenosAires(new Date('2026-11-02T02:59:00.000Z'))).toBe('2026-11-01');
    expect(getCurrentDateInBuenosAires(new Date('2026-11-02T03:01:00.000Z'))).toBe('2026-11-02');
  });
});

describe('getCurrentWeekStartInBuenosAires', () => {
  it('uses the Buenos Aires calendar date around the Monday boundary', () => {
    expect(getCurrentWeekStartInBuenosAires(new Date('2026-11-02T02:59:00.000Z'))).toBe('2026-10-26');
    expect(getCurrentWeekStartInBuenosAires(new Date('2026-11-02T03:01:00.000Z'))).toBe('2026-11-02');
  });

  it('returns a calendar date without a time or timezone suffix', () => {
    expect(getCurrentWeekStartInBuenosAires(new Date('2026-11-04T15:00:00.000Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
