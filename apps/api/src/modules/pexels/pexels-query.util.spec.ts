/**
 * Contract under test (does not exist yet — this is the failing-red step of TDD):
 *
 *   apps/api/src/modules/plans/pexels/pexels-query.util.ts
 *
 * exports:
 *   buildPexelsQuery(title: string): string
 *
 * implementing EXACTLY the normalization algorithm in design.md section 2:
 *   1. Unicode NFKD normalization.
 *   2. Strip combining diacritical marks (range ̀-ͯ).
 *   3. Trim leading/trailing whitespace.
 *   4. Collapse internal whitespace (spaces/tabs/newlines) to a single ASCII space.
 *   5. Lowercase (no special locale).
 *   6. Concatenate with the fixed literal suffix " food recipe".
 *
 * See design.md section 2 "Casos borde a cubrir explícitamente en los tests" for the
 * exact cases this spec must cover, and plan.md section 7 (AC1 row) for the file mapping.
 */
import { buildPexelsQuery } from './pexels-query.util';

describe('buildPexelsQuery', () => {
  it('normalizes accents, mixed case, and irregular whitespace (tabs/multiple spaces) to the exact expected string (design.md section 2 example)', () => {
    expect(buildPexelsQuery('  Ñoquis   de\tPapá  ')).toBe('noquis de papa food recipe');
  });

  it('only lowercases and appends the suffix when the title is already clean (no accents, single spaces, single case)', () => {
    expect(buildPexelsQuery('Pasta Carbonara')).toBe('pasta carbonara food recipe');
  });

  it('degrades to "food recipe" when the title collapses to empty/whitespace-only, without throwing', () => {
    expect(() => buildPexelsQuery('   ')).not.toThrow();
    expect(buildPexelsQuery('   ')).toBe('food recipe');
  });

  it('degrades to "food recipe" for an empty string input, without throwing', () => {
    expect(() => buildPexelsQuery('')).not.toThrow();
    expect(buildPexelsQuery('')).toBe('food recipe');
  });

  it('is deterministic: calling it twice with the same input produces the exact same output', () => {
    const input = '  Ñoquis   de\tPapá  ';

    const result1 = buildPexelsQuery(input);
    const result2 = buildPexelsQuery(input);

    expect(result1).toBe(result2);
  });

  it('normalizes mixed-case input without accents (e.g. "TorTa De ManZAna") to lowercase plus suffix', () => {
    expect(buildPexelsQuery('TorTa De ManZAna')).toBe('torta de manzana food recipe');
  });

  it('collapses multiple consecutive internal spaces to a single space', () => {
    expect(buildPexelsQuery('Arroz     con      pollo')).toBe('arroz con pollo food recipe');
  });
});
