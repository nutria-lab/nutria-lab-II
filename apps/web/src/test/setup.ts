import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom no implementa `window.matchMedia` (usado por `useMediaQuery`, NUT-20 octava
// iteración). Los tests que ejercitan el hook directamente lo reemplazan puntualmente con
// `vi.stubGlobal('matchMedia', ...)` (ver `useMediaQuery.test.ts`) o mockean el hook completo
// (`RecipesListPage.test.tsx`/`RecipeDetailPage.test.tsx`). Este polyfill sólo cubre los tests
// de integración (p. ej. `App.test.tsx`) que montan páginas reales sin mockear ninguno de los
// dos, para que no rompan con un `TypeError` — por defecto reporta "no coincide" (mobile), el
// mismo comportamiento ya asumido por todos los tests existentes antes de este hook existir.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
});
