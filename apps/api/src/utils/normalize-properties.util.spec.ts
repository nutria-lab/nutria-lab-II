import { normalizeProperties } from './normalize-properties.util';

describe('normalizeProperties utility', () => {
  it('should trim edges, collapse spaces, discard empty strings, and deduplicate case-insensitively preserving first case', () => {
    const input = [
      '  Sin Gluten  ',
      'Alto   en   Fibra',
      'sin gluten',
      '   ',
      '',
      'ALTO EN FIBRA',
      'Vegano'
    ];

    const result = normalizeProperties(input);

    expect(result).toEqual(['Sin Gluten', 'Alto en Fibra', 'Vegano']);
  });

  it('should return empty array for non-array input', () => {
    expect(normalizeProperties(null as any)).toEqual([]);
    expect(normalizeProperties(undefined as any)).toEqual([]);
  });

  it('should handle empty array', () => {
    expect(normalizeProperties([])).toEqual([]);
  });
});
