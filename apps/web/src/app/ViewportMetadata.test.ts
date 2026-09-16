import { describe, expect, it } from 'vitest';
import indexHtml from '../../index.html?raw';

describe('public viewport metadata', () => {
  it('enables the safe-area viewport so mobile navigation can use the reported inset', () => {
    expect(indexHtml).toMatch(
      /<meta\b(?=[^>]*\bname=["']viewport["'])(?=[^>]*\bcontent=["'][^"']*\bviewport-fit=cover\b[^"']*["'])[^>]*>/i,
    );
  });
});
