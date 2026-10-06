import { isValidUnsplashUrl } from './unsplash-url-validator.util';

describe('isValidUnsplashUrl', () => {
  it('accepts an HTTPS URL whose host matches exactly', () => {
    expect(isValidUnsplashUrl('https://images.unsplash.com/photo-1001?w=1080', 'images.unsplash.com')).toBe(true);
  });

  it('rejects an HTTP (non-HTTPS) URL even when the host is correct', () => {
    expect(isValidUnsplashUrl('http://images.unsplash.com/photo-1001', 'images.unsplash.com')).toBe(false);
  });

  it('rejects an HTTPS URL whose host does not match the expected one', () => {
    expect(isValidUnsplashUrl('https://evil.com/photo-1001', 'images.unsplash.com')).toBe(false);
  });

  it('rejects a look-alike subdomain host (images.unsplash.com.evil.com)', () => {
    expect(isValidUnsplashUrl('https://images.unsplash.com.evil.com/photo-1001', 'images.unsplash.com')).toBe(false);
  });

  it('rejects the userinfo trick (hostname resolves to the part after @, not before it)', () => {
    expect(isValidUnsplashUrl('https://images.unsplash.com@evil.com/photo-1001', 'images.unsplash.com')).toBe(false);
  });

  it('rejects a malformed URL without throwing', () => {
    expect(() => isValidUnsplashUrl('not a url', 'images.unsplash.com')).not.toThrow();
    expect(isValidUnsplashUrl('not a url', 'images.unsplash.com')).toBe(false);
  });

  it.each([undefined, null, '', 42, true, {}])('rejects a non-string/empty value (%p) without throwing', (value) => {
    expect(() => isValidUnsplashUrl(value as unknown as string, 'images.unsplash.com')).not.toThrow();
    expect(isValidUnsplashUrl(value as unknown as string, 'images.unsplash.com')).toBe(false);
  });

  describe('the 4 real Unsplash hosts that matter (design.md 3.4)', () => {
    it('urls.regular -> images.unsplash.com', () => {
      const url =
        'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?ixid=M3w0NjAwMjN8MHwxfHNlYXJjaHwxfHxmb29kfGVufDB8fHx8MTcwMDAwMDAwMHww&ixlib=rb-4.0.3';
      expect(isValidUnsplashUrl(url, 'images.unsplash.com')).toBe(true);
    });

    it('links.html -> unsplash.com', () => {
      expect(isValidUnsplashUrl('https://unsplash.com/photos/LBI7cgq3pbM', 'unsplash.com')).toBe(true);
    });

    it('user.links.html -> unsplash.com', () => {
      expect(isValidUnsplashUrl('https://unsplash.com/@jane-doe', 'unsplash.com')).toBe(true);
    });

    it('links.download_location -> api.unsplash.com', () => {
      const url =
        'https://api.unsplash.com/photos/LBI7cgq3pbM/download?ixid=M3w0NjAwMjN8MHwxfHNlYXJjaHwxfHxmb29kfGVufDB8fHx8MTcwMDAwMDAwMHww';
      expect(isValidUnsplashUrl(url, 'api.unsplash.com')).toBe(true);
    });

    it('rejects a URL using the wrong host for its field (unsplash.com used where images.unsplash.com is expected)', () => {
      expect(isValidUnsplashUrl('https://unsplash.com/photos/LBI7cgq3pbM', 'images.unsplash.com')).toBe(false);
    });
  });
});
