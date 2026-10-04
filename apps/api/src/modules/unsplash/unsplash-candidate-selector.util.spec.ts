// Los overrides reemplazan claves completas a propósito, para poder sacar un campo anidado.
import { selectUnsplashCandidate } from './unsplash-candidate-selector.util';
import { unsplashPhoto } from './unsplash-search.fixture';

function validCandidate(overrides: Record<string, unknown> = {}) {
  const id = typeof overrides.id === 'string' ? overrides.id : 'LBI7cgq3pbM';
  return { ...unsplashPhoto(id), ...overrides };
}

describe('selectUnsplashCandidate', () => {
  it('selects the first candidate when it fully satisfies the predicate', () => {
    const first = validCandidate({ id: 'aB3dE5gH7jK' });
    const second = validCandidate({ id: 'Zq9xW2vU4tS' });

    expect(selectUnsplashCandidate([first, second])).toEqual(first);
  });

  describe('skips an invalid first candidate and falls through to the next valid one', () => {
    it('skips a first candidate missing user.links.html', () => {
      const invalidFirst = validCandidate({ id: 'aB3dE5gH7jK', user: { name: 'Jane Doe', links: { html: '' } } });
      const validSecond = validCandidate({ id: 'Zq9xW2vU4tS' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate missing user.name', () => {
      const invalidFirst = validCandidate({
        id: 'aB3dE5gH7jK',
        user: { name: '', links: { html: 'https://unsplash.com/@jane-doe' } },
      });
      const validSecond = validCandidate({ id: 'Zq9xW2vU4tS' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate missing links.html', () => {
      const invalidFirst = validCandidate({
        id: 'aB3dE5gH7jK',
        links: { html: '', download_location: 'https://api.unsplash.com/photos/photo-aaa/download' },
      });
      const validSecond = validCandidate({ id: 'Zq9xW2vU4tS' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate missing urls.regular', () => {
      const invalidFirst = validCandidate({ id: 'aB3dE5gH7jK', urls: { regular: '' } });
      const validSecond = validCandidate({ id: 'Zq9xW2vU4tS' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate with width = 0', () => {
      const invalidFirst = validCandidate({ id: 'aB3dE5gH7jK', width: 0 });
      const validSecond = validCandidate({ id: 'Zq9xW2vU4tS' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate with negative height', () => {
      const invalidFirst = validCandidate({ id: 'aB3dE5gH7jK', height: -100 });
      const validSecond = validCandidate({ id: 'Zq9xW2vU4tS' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate with a non-integer width', () => {
      const invalidFirst = validCandidate({ id: 'aB3dE5gH7jK', width: 1200.5 });
      const validSecond = validCandidate({ id: 'Zq9xW2vU4tS' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate with an empty links.download_location', () => {
      const invalidFirst = validCandidate({
        id: 'aB3dE5gH7jK',
        links: { html: 'https://unsplash.com/photos/photo-aaa', download_location: '' },
      });
      const validSecond = validCandidate({ id: 'Zq9xW2vU4tS' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate with links.download_location absent entirely', () => {
      const invalidFirst = validCandidate({
        id: 'aB3dE5gH7jK',
        links: { html: 'https://unsplash.com/photos/photo-aaa' },
      });
      const validSecond = validCandidate({ id: 'Zq9xW2vU4tS' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate whose urls.regular points to a non-Unsplash host', () => {
      const invalidFirst = validCandidate({ id: 'aB3dE5gH7jK', urls: { regular: 'https://evil.com/foo.jpg' } });
      const validSecond = validCandidate({ id: 'Zq9xW2vU4tS' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });

    it('skips a first candidate whose links.download_location points to a non-Unsplash host', () => {
      const invalidFirst = validCandidate({
        id: 'aB3dE5gH7jK',
        links: {
          html: 'https://unsplash.com/photos/photo-aaa',
          download_location: 'https://evil.com/photos/photo-aaa/download',
        },
      });
      const validSecond = validCandidate({ id: 'Zq9xW2vU4tS' });

      expect(selectUnsplashCandidate([invalidFirst, validSecond])).toEqual(validSecond);
    });
  });

  it('returns null when the only candidate has an empty links.download_location', () => {
    const onlyCandidate = validCandidate({
      id: 'aB3dE5gH7jK',
      links: { html: 'https://unsplash.com/photos/photo-aaa', download_location: '' },
    });

    expect(selectUnsplashCandidate([onlyCandidate])).toBeNull();
  });

  it('returns null when no candidate in the array is valid, without throwing', () => {
    const invalidOne = validCandidate({ id: 'aB3dE5gH7jK', links: { html: '', download_location: 'x' } });
    const invalidTwo = validCandidate({ id: 'Zq9xW2vU4tS', width: -1 });

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
      id: 'Dp7uPl1cAte',
      user: { name: 'First Photographer', links: { html: 'https://unsplash.com/@first' } },
    });
    const secondWithSameId = validCandidate({
      id: 'Dp7uPl1cAte',
      user: { name: 'Second Photographer', links: { html: 'https://unsplash.com/@second' } },
    });

    const result = selectUnsplashCandidate([firstWithDuplicateId, secondWithSameId]);

    expect(result).toEqual(firstWithDuplicateId);
    expect(result?.user.name).toBe('First Photographer');
  });

  it('is deterministic: selecting twice over the same response body yields exactly the same candidate', () => {
    const results = [
      validCandidate({ id: 'aB3dE5gH7jK', links: { html: '', download_location: 'x' } }),
      validCandidate({ id: 'Zq9xW2vU4tS' }),
      validCandidate({ id: 'Mn1pQ3rT5vX' }),
    ];

    const result1 = selectUnsplashCandidate(results);
    const result2 = selectUnsplashCandidate(results);

    expect(result1).toEqual(result2);
    expect(result1).toEqual(validCandidate({ id: 'Zq9xW2vU4tS' }));
  });
});
