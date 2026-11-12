/**
 * NUT-114 — Synthetic identity conventions exported by `apps/api/src/prisma/seed-data.ts` (Block 1, TDD red first).
 *
 * Expected additions to seed-data.ts (pure constants/functions only; they are compiled into dist):
 *
 *   export const SYNTHETIC_EMAIL_DOMAIN = 'nutria.test';
 *   export function syntheticEmail(n: number): string;      // 1 -> 'demo.seed.00001@nutria.test' (5-digit zero pad)
 *   export function syntheticName(n: number): string;       // 1 -> 'Demo Sintético 00001'
 *   export const DEMO_WALKTHROUGH_EMAIL = 'demo.seed.00001@nutria.test';
 *   export const SEED_TABLE_CODES = {
 *     users: '0001', recipes: '0002', mealPlans: '0003', days: '0004', meals: '0005',
 *     profiles: '0006', ingredients: '0007', completions: '0008', shoppingChecks: '0009',
 *   } as const;
 *   export type SeedTable = keyof typeof SEED_TABLE_CODES;
 *   // '5eed' + code + '-0000-4000-8000-' + n zero-padded to 12 digits. Throws RangeError when n is not an
 *   // integer in [0, 999999999999].
 *   export function synthId(table: SeedTable, n: number): string;
 */
import {
  DEMO_WALKTHROUGH_EMAIL,
  RECETA_POLLO_ID,
  SEED_TABLE_CODES,
  SYNTHETIC_EMAIL_DOMAIN,
  syntheticEmail,
  syntheticName,
  synthId,
} from '../seed-data';

const SYNTH_ID = /^5eed\d{4}-0000-4000-8000-\d{12}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('seed-data synthetic conventions', () => {
  it('exposes the email domain and walkthrough account', () => {
    expect(SYNTHETIC_EMAIL_DOMAIN).toBe('nutria.test');
    expect(DEMO_WALKTHROUGH_EMAIL).toBe('demo.seed.00001@nutria.test');
    expect(syntheticEmail(1)).toBe(DEMO_WALKTHROUGH_EMAIL);
  });

  it('formats emails and names with 5-digit zero padding', () => {
    expect(syntheticEmail(42)).toBe('demo.seed.00042@nutria.test');
    expect(syntheticEmail(5000)).toBe('demo.seed.05000@nutria.test');
    expect(syntheticName(1)).toBe('Demo Sintético 00001');
    expect(syntheticName(5000)).toBe('Demo Sintético 05000');
  });

  it('defines the agreed table codes', () => {
    expect(SEED_TABLE_CODES).toEqual({
      users: '0001',
      recipes: '0002',
      mealPlans: '0003',
      days: '0004',
      meals: '0005',
      profiles: '0006',
      ingredients: '0007',
      completions: '0008',
      shoppingChecks: '0009',
    });
  });

  it('builds ids as 5eedTTTT-0000-4000-8000-NNNNNNNNNNNN', () => {
    expect(synthId('users', 1)).toBe('5eed0001-0000-4000-8000-000000000001');
    expect(synthId('shoppingChecks', 5000)).toBe('5eed0009-0000-4000-8000-000000005000');
    expect(synthId('mealPlans', 920261102000)).toBe('5eed0003-0000-4000-8000-920261102000');
    for (const table of Object.keys(SEED_TABLE_CODES) as Array<keyof typeof SEED_TABLE_CODES>) {
      const id = synthId(table, 7);
      expect(id).toMatch(SYNTH_ID);
      expect(id).toMatch(UUID_V4);
      expect(id.slice(4, 8)).toBe(SEED_TABLE_CODES[table]);
      expect(id).not.toBe(RECETA_POLLO_ID);
    }
  });

  it('rejects out-of-range or non-integer indexes', () => {
    expect(() => synthId('users', -1)).toThrow(RangeError);
    expect(() => synthId('users', 1.5)).toThrow(RangeError);
    expect(() => synthId('users', 1_000_000_000_000)).toThrow(RangeError);
  });
});
