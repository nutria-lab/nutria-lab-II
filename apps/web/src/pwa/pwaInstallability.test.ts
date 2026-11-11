import { describe, expect, it } from 'vitest';

// @ts-expect-error Node file access is provided by Vitest; the app intentionally has no @types/node dependency.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest runs this static contract test from the web package directory.
const webRoot = process.cwd();
const readWebFile = (path: string) => readFileSync(`${webRoot}/${path}`);
const readWebText = (path: string) => new TextDecoder().decode(readWebFile(path));

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
};

type WebManifest = {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
};

function pngDimensions(bytes: Uint8Array) {
  expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: header.getUint32(16), height: header.getUint32(20) };
}

describe('basic PWA installability', () => {
  it('publishes NutrIA install metadata with root scope and standalone display', () => {
    const manifest = JSON.parse(readWebText('public/manifest.webmanifest')) as WebManifest;

    expect(manifest).toMatchObject({
      name: 'NutrIA',
      short_name: 'NutrIA',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    expect(new URL(manifest.start_url, 'https://nutria.example/').pathname.startsWith(manifest.scope)).toBe(true);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('declares readable square 192px and 512px PNG icons at their published paths', () => {
    const manifest = JSON.parse(readWebText('public/manifest.webmanifest')) as WebManifest;

    for (const size of [192, 512]) {
      const icon = manifest.icons.find((candidate) => candidate.sizes === `${size}x${size}`);
      expect(icon, `missing ${size}x${size} manifest icon`).toBeDefined();
      expect(icon?.type).toBe('image/png');
      expect(icon?.purpose ?? 'any').toBe('any');
      expect(icon?.src).toMatch(/^\/(?!\/).+\.png$/);

      const bytes = readWebFile(`public${icon?.src}`);
      expect(pngDimensions(bytes)).toEqual({ width: size, height: size });
    }
  });

  it('links the manifest and platform theme and home-screen icon metadata from the app document', () => {
    const html = readWebText('index.html');
    const document = new DOMParser().parseFromString(html, 'text/html');
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    const themeColor = document.querySelector('meta[name="theme-color"]');
    const appleCapable = document.querySelector('meta[name="apple-mobile-web-app-capable"]');

    expect(manifestLink?.getAttribute('href')).toBe('/manifest.webmanifest');
    expect(themeColor?.getAttribute('content')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(appleCapable?.getAttribute('content')?.toLowerCase()).toBe('yes');
    expect(appleIcon?.getAttribute('href')).toMatch(/^\/(?!\/).+\.png$/);
    expect(readWebFile(`public${appleIcon?.getAttribute('href')}`)).toBeTruthy();
  });

  it('keeps the SPA deployment at the domain root with its existing Vercel fallback', () => {
    const viteConfig = readWebText('vite.config.ts');
    const vercel = JSON.parse(readWebText('vercel.json')) as {
      outputDirectory: string;
      rewrites: Array<{ source: string; destination: string }>;
    };

    expect(viteConfig).not.toMatch(/\bbase\s*:\s*['"][^/]/);
    expect(vercel.outputDirectory).toBe('dist');
    expect(vercel.rewrites.at(-1)).toEqual({ source: '/(.*)', destination: '/index.html' });
  });
});
