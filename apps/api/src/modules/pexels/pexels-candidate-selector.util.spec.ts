/**
 * Contract under test (does not exist yet — this is the failing-red step of TDD):
 *
 *   apps/api/src/modules/plans/pexels/pexels-candidate-selector.util.ts
 *
 * exports:
 *   selectPexelsCandidate(photos: unknown): PexelsCandidate | null
 *
 * implementing EXACTLY design.md section 3:
 *   - Validates the HTTP response shape first: `photos` must be an array, otherwise `null`
 *     (this spec simulates that "invalid response shape" validation directly by passing
 *     non-array values, since this util receives the already-parsed `photos` value — the
 *     surrounding HTTP/JSON-parsing concerns belong to pexels.service.ts, not this pure util).
 *   - Validity predicate per candidate: id (finite, non-null), src.large (non-empty string),
 *     url (non-empty string), photographer (non-empty string), photographer_url (non-empty
 *     string), width/height present, numeric, integer, and both > 0.
 *   - Selection: first element in array order that satisfies the full predicate.
 *   - Tie-break: duplicate `id` values are treated as the same candidate; the first one by
 *     position wins, never duplicated.
 *
 * See plan.md section 7 (AC2 row) for the file mapping and the it.each table pattern used
 * elsewhere in this codebase (apps/api/src/modules/plans/generation-run-state-machine.spec.ts).
 */
import { selectPexelsCandidate } from './pexels-candidate-selector.util';

function validCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    src: { large: 'https://images.pexels.com/photos/1001/large.jpg' },
    url: 'https://www.pexels.com/photo/1001/',
    photographer: 'Jane Doe',
    photographer_url: 'https://www.pexels.com/@jane-doe',
    width: 1200,
    height: 800,
    ...overrides
  };
}

describe('selectPexelsCandidate', () => {
  it('selects the first candidate when it fully satisfies the predicate', () => {
    const first = validCandidate({ id: 1 });
    const second = validCandidate({ id: 2 });

    const result = selectPexelsCandidate([first, second]);

    expect(result).toEqual(first);
  });

  describe('skips an invalid first candidate and falls through to the next valid one', () => {
    it('skips a first candidate missing photographer_url', () => {
      const invalidFirst = validCandidate({ id: 1, photographer_url: '' });
      const validSecond = validCandidate({ id: 2 });

      expect(selectPexelsCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate with width = 0', () => {
      const invalidFirst = validCandidate({ id: 1, width: 0 });
      const validSecond = validCandidate({ id: 2 });

      expect(selectPexelsCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate with negative height', () => {
      const invalidFirst = validCandidate({ id: 1, height: -100 });
      const validSecond = validCandidate({ id: 2 });

      expect(selectPexelsCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate with a non-integer width', () => {
      const invalidFirst = validCandidate({ id: 1, width: 1200.5 });
      const validSecond = validCandidate({ id: 2 });

      expect(selectPexelsCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });
  });

  it('returns null when no candidate in the array is valid, without throwing', () => {
    const invalidOne = validCandidate({ id: 1, url: '' });
    const invalidTwo = validCandidate({ id: 2, width: -1 });

    expect(() => selectPexelsCandidate([invalidOne, invalidTwo])).not.toThrow();
    expect(selectPexelsCandidate([invalidOne, invalidTwo])).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(selectPexelsCandidate([])).toBeNull();
  });

  describe('returns null without throwing when photos is not an array (invalid response shape)', () => {
    it.each([undefined, null, { photos: [] }, 'not-an-array', 42, true])('photos = %p', (invalidPhotos) => {
      expect(() => selectPexelsCandidate(invalidPhotos)).not.toThrow();
      expect(selectPexelsCandidate(invalidPhotos)).toBeNull();
    });
  });

  it('treats duplicate ids as a single candidate, choosing the first by position without duplicating the result', () => {
    const firstWithDuplicateId = validCandidate({ id: 555, photographer: 'First Photographer' });
    const secondWithSameId = validCandidate({ id: 555, photographer: 'Second Photographer' });

    const result = selectPexelsCandidate([firstWithDuplicateId, secondWithSameId]);

    expect(result).toEqual(firstWithDuplicateId);
    expect(result?.photographer).toBe('First Photographer');
  });

  it('is deterministic: selecting twice over the same response body yields exactly the same candidate', () => {
    const photos = [validCandidate({ id: 1, photographer_url: '' }), validCandidate({ id: 2 }), validCandidate({ id: 3 })];

    const result1 = selectPexelsCandidate(photos);
    const result2 = selectPexelsCandidate(photos);

    expect(result1).toEqual(result2);
    expect(result1).toEqual(validCandidate({ id: 2 }));
  });
});
