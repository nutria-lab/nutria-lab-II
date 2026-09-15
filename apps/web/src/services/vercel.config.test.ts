import { describe, expect, it } from 'vitest';

import vercelConfig from '../../vercel.json';

describe('Vercel rewrites', () => {
  it('routes the same-site API prefix to the backend before the SPA fallback', () => {
    expect(vercelConfig.rewrites).toEqual([
      {
        source: '/api/:path*',
        destination: 'https://nutria-lab-ii-api.vercel.app/:path*',
      },
      {
        source: '/(.*)',
        destination: '/index.html',
      },
    ]);
  });
});
