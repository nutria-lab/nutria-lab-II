// Selection/tie-break logic is unchanged by the Pexels -> Unsplash swap (design.md 11.2):
// first-by-position candidate that satisfies the validity predicate, duplicate ids collapse
// to the first occurrence. Only the candidate field names/shape change (plan.md 11.2).
//
// `id` is a string here (design.md 12.1/12.2 fix #1): Unsplash's real API returns string ids
// (e.g. "LBI7cgq3pbM"), never numbers - a numeric fixture is not a realistic response shape.
import { selectUnsplashCandidate } from './unsplash-candidate-selector.util';

function validCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'LBI7cgq3pbM',
    urls: { regular: 'https://images.unsplash.com/photo-1001?w=1080' },
    links: {
      html: 'https://unsplash.com/photos/LBI7cgq3pbM',
      download_location: 'https://api.unsplash.com/photos/LBI7cgq3pbM/download',
    },
    user: { name: 'Jane Doe', links: { html: 'https://unsplash.com/@jane-doe' } },
    alt_description: 'noquis de papa served on a plate',
    width: 1200,
    height: 800,
    ...overrides,
  };
}

describe('selectUnsplashCandidate', () => {
  it('selects the first candidate when it fully satisfies the predicate', () => {
    const first = validCandidate({ id: 'photo-aaa' });
    const second = validCandidate({ id: 'photo-bbb' });

    expect(selectUnsplashCandidate([first, second])).toEqual(first);
  });

  describe('skips an invalid first candidate and falls through to the next valid one', () => {
    it('skips a first candidate missing user.links.html', () => {
      const invalidFirst = validCandidate({ id: 'photo-aaa', user: { name: 'Jane Doe', links: { html: '' } } });
      const validSecond = validCandidate({ id: 'photo-bbb' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate missing user.name', () => {
      const invalidFirst = validCandidate({
        id: 'photo-aaa',
        user: { name: '', links: { html: 'https://unsplash.com/@jane-doe' } },
      });
      const validSecond = validCandidate({ id: 'photo-bbb' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate missing links.html', () => {
      const invalidFirst = validCandidate({
        id: 'photo-aaa',
        links: { html: '', download_location: 'https://api.unsplash.com/photos/photo-aaa/download' },
      });
      const validSecond = validCandidate({ id: 'photo-bbb' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate missing urls.regular', () => {
      const invalidFirst = validCandidate({ id: 'photo-aaa', urls: { regular: '' } });
      const validSecond = validCandidate({ id: 'photo-bbb' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate with width = 0', () => {
      const invalidFirst = validCandidate({ id: 'photo-aaa', width: 0 });
      const validSecond = validCandidate({ id: 'photo-bbb' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate with negative height', () => {
      const invalidFirst = validCandidate({ id: 'photo-aaa', height: -100 });
      const validSecond = validCandidate({ id: 'photo-bbb' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate with a non-integer width', () => {
      const invalidFirst = validCandidate({ id: 'photo-aaa', width: 1200.5 });
      const validSecond = validCandidate({ id: 'photo-bbb' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    // Fix #2 (design.md 12.1/12.2): download_location is required for tracking (design.md
    // 11.2) but was never validated as part of candidate shape - a candidate missing it must
    // not reach selection at all, instead of surfacing the gap later when tracking runs.
    it('skips a first candidate with an empty links.download_location', () => {
      const invalidFirst = validCandidate({
        id: 'photo-aaa',
        links: { html: 'https://unsplash.com/photos/photo-aaa', download_location: '' },
      });
      const validSecond = validCandidate({ id: 'photo-bbb' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate with links.download_location absent entirely', () => {
      const invalidFirst = validCandidate({
        id: 'photo-aaa',
        links: { html: 'https://unsplash.com/photos/photo-aaa' },
      });
      const validSecond = validCandidate({ id: 'photo-bbb' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    // Fix #3 (design.md 12.2/12.3): every URL field is validated against its expected
    // Unsplash host before a candidate is accepted - a response that smuggles a foreign host
    // in any of the 4 URL fields must be discarded, same as any other malformed field.
    it('skips a first candidate whose urls.regular points to a non-Unsplash host', () => {
      const invalidFirst = validCandidate({ id: 'photo-aaa', urls: { regular: 'https://evil.com/foo.jpg' } });
      const validSecond = validCandidate({ id: 'photo-bbb' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate whose links.download_location points to a non-Unsplash host', () => {
      const invalidFirst = validCandidate({
        id: 'photo-aaa',
        links: {
          html: 'https://unsplash.com/photos/photo-aaa',
          download_location: 'https://evil.com/photos/photo-aaa/download',
        },
      });
      const validSecond = validCandidate({ id: 'photo-bbb' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });
  });

  it('returns null when the only candidate has an empty links.download_location', () => {
    const onlyCandidate = validCandidate({
      id: 'photo-aaa',
      links: { html: 'https://unsplash.com/photos/photo-aaa', download_location: '' },
    });

    expect(selectUnsplashCandidate([onlyCandidate])).toBeNull();
  });

  it('returns null when no candidate in the array is valid, without throwing', () => {
    const invalidOne = validCandidate({ id: 'photo-aaa', links: { html: '', download_location: 'x' } });
    const invalidTwo = validCandidate({ id: 'photo-bbb', width: -1 });

    expect(() => selectUnsplashCandidate([invalidOne, invalidTwo])).not.toThrow();
    expect(selectUnsplashCandidate([invalidOne, invalidTwo])).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(selectUnsplashCandidate([])).toBeNull();
  });

  describe('returns null without throwing when results is not an array (invalid response shape)', () => {
    it.each([undefined, null, { results: [] }, 'not-an-array', 42, true])('results = %p', (invalidResults) => {
      expect(() => selectUnsplashCandidate(invalidResults)).not.toThrow();
      expect(selectUnsplashCandidate(invalidResults)).toBeNull();
    });
  });

  it('treats duplicate ids as a single candidate, choosing the first by position without duplicating the result', () => {
    const firstWithDuplicateId = validCandidate({
      id: 'photo-dup',
      user: { name: 'First Photographer', links: { html: 'https://unsplash.com/@first' } },
    });
    const secondWithSameId = validCandidate({
      id: 'photo-dup',
      user: { name: 'Second Photographer', links: { html: 'https://unsplash.com/@second' } },
    });

    const result = selectUnsplashCandidate([firstWithDuplicateId, secondWithSameId]);

    expect(result).toEqual(firstWithDuplicateId);
    expect(result?.user.name).toBe('First Photographer');
  });

  it('is deterministic: selecting twice over the same response body yields exactly the same candidate', () => {
    const results = [
      validCandidate({ id: 'photo-aaa', links: { html: '', download_location: 'x' } }),
      validCandidate({ id: 'photo-bbb' }),
      validCandidate({ id: 'photo-ccc' }),
    ];

    const result1 = selectUnsplashCandidate(results);
    const result2 = selectUnsplashCandidate(results);

    expect(result1).toEqual(result2);
    expect(result1).toEqual(validCandidate({ id: 'photo-bbb' }));
  });
});
