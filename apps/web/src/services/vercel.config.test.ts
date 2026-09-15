import { describe, expect, it } from 'vitest';
import vercelConfig from '../../vercel.json';

type VercelConfig = {
  rewrites?: Array<{ source?: string; destination?: string }>;
};

describe('web Vercel routing', () => {
  it('proxies API requests before the SPA fallback', () => {
    const config = vercelConfig as VercelConfig;
    const rewrites = config.rewrites ?? [];
    const apiRewrite = rewrites.findIndex((rewrite) => (
      rewrite.source === '/api/:path*'
      && rewrite.destination === 'https://nutria-lab-ii-api.vercel.app/:path*'
    ));
    const spaFallback = rewrites.findIndex((rewrite) => (
      rewrite.source === '/(.*)' && rewrite.destination === '/index.html'
    ));

    expect(apiRewrite).toBeGreaterThanOrEqual(0);
    expect(spaFallback).toBeGreaterThanOrEqual(0);
    expect(apiRewrite).toBeLessThan(spaFallback);
  });
});
