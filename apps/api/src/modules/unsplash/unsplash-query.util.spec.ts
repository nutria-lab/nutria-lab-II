import { buildUnsplashQuery } from './unsplash-query.util';

describe('buildUnsplashQuery', () => {
  it('normalizes accents, mixed case, and irregular whitespace (tabs/multiple spaces)', () => {
    expect(buildUnsplashQuery('  Ñoquis   de\tPapá  ')).toBe('noquis de papa food recipe');
  });

  it('only lowercases and appends the suffix when the title is already clean', () => {
    expect(buildUnsplashQuery('Pasta Carbonara')).toBe('pasta carbonara food recipe');
  });

  it('degrades to "food recipe" when the title collapses to empty/whitespace-only, without throwing', () => {
    expect(() => buildUnsplashQuery('   ')).not.toThrow();
    expect(buildUnsplashQuery('   ')).toBe('food recipe');
  });

  it('degrades to "food recipe" for an empty string input, without throwing', () => {
    expect(() => buildUnsplashQuery('')).not.toThrow();
    expect(buildUnsplashQuery('')).toBe('food recipe');
  });

  it('is deterministic: calling it twice with the same input produces the exact same output', () => {
    const input = '  Ñoquis   de\tPapá  ';

    expect(buildUnsplashQuery(input)).toBe(buildUnsplashQuery(input));
  });

  it('normalizes mixed-case input without accents to lowercase plus suffix', () => {
    expect(buildUnsplashQuery('TorTa De ManZAna')).toBe('torta de manzana food recipe');
  });

  it('collapses multiple consecutive internal spaces to a single space', () => {
    expect(buildUnsplashQuery('Arroz     con      pollo')).toBe('arroz con pollo food recipe');
  });
});
