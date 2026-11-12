import { describe, expect, it } from 'vitest';

import {
  DEFAULT_POST_LOGIN_PATH,
  resolvePostLoginDestination,
} from '@/features/auth/postLoginDestination';

describe('resolvePostLoginDestination', () => {
  it('uses /dashboard as the default destination', () => {
    expect(DEFAULT_POST_LOGIN_PATH).toBe('/dashboard');
  });

  it.each([
    ['no state', undefined],
    ['null', null],
    ['a non-object value', 42],
    ['an object without pathname', { search: '?x=1' }],
    ['a non-string pathname', { pathname: ['/shopping-list'] }],
    ['an empty pathname', { pathname: '' }],
  ])('falls back to /dashboard for %s', (_label, from) => {
    expect(resolvePostLoginDestination(from)).toBe('/dashboard');
  });

  it.each([
    ['/dashboard'],
    ['/shopping-list'],
    ['/meal-plan'],
    ['/recipes'],
    ['/recipes/generate'],
    ['/recipes/9b1c2d3e-recipe'],
    ['/goals'],
  ])('keeps the internal app path %s', (pathname) => {
    expect(resolvePostLoginDestination({ pathname })).toBe(pathname);
  });

  it('keeps the search and hash of an internal destination', () => {
    expect(resolvePostLoginDestination({
      pathname: '/meal-plan',
      search: '?day=2026-11-12',
      hash: '#dinner',
    })).toBe('/meal-plan?day=2026-11-12#dinner');
  });

  it('ignores search and hash values that are not strings', () => {
    expect(resolvePostLoginDestination({ pathname: '/shopping-list', search: 7, hash: null }))
      .toBe('/shopping-list');
  });

  it.each([
    ['protocol-relative URL', '//evil.test'],
    ['protocol-relative URL with path', '//evil.test/dashboard'],
    ['backslash after the first slash', '/\\evil.test'],
    ['backslash protocol-relative URL', '\\\\evil.test'],
    ['mixed slashes', '/\\/evil.test'],
    ['https absolute URL', 'https://evil.test/dashboard'],
    ['http absolute URL', 'http://evil.test'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['upper-case javascript scheme', 'JavaScript:alert(1)'],
    ['data scheme', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript scheme', 'vbscript:msgbox(1)'],
    ['relative path', 'dashboard'],
    ['leading whitespace', ' /dashboard'],
    ['tab inside the slashes', '/\t/evil.test'],
    ['newline inside the slashes', '/\n/evil.test'],
    ['null character', '/dashboard\u0000'],
    ['delete character', '/dash\u007Fboard'],
    ['backslash later in the path', '/recipes\\evil'],
  ])('rejects a %s and falls back to /dashboard', (_label, pathname) => {
    expect(resolvePostLoginDestination({ pathname })).toBe('/dashboard');
  });

  it('rejects an external destination smuggled through search or hash', () => {
    expect(resolvePostLoginDestination({ pathname: '/', search: '/evil.test' })).toBe('/dashboard');
    expect(resolvePostLoginDestination({ pathname: '/dashboard', hash: '\n//evil.test' })).toBe('/dashboard');
  });

  it.each([['/login'], ['/register'], ['/login?x=1']])(
    'does not return to the public auth route %s',
    (pathname) => {
      expect(resolvePostLoginDestination({ pathname })).toBe('/dashboard');
    },
  );
});
