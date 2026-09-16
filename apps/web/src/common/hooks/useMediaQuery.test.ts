import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMediaQuery } from './useMediaQuery';

// NUT-20 (octava iteración, tester) — adaptación tablet/desktop (design.md sección 9.2/9.4):
// `useMediaQuery` es un hook GENÉRICO nuevo (`apps/web/src/common/hooks/useMediaQuery.ts`,
// todavía no existe) sobre `window.matchMedia`, reutilizable para cualquier query — este test
// no fija ningún breakpoint concreto a propósito (el breakpoint real, `(min-width: 768px)` /
// `md:`, ya usado por `Sidebar.tsx`/`AppLayout.tsx`/`BottomNavigation.tsx`, lo decide quien
// consuma el hook, no el hook en sí). Se espera ROJO hoy por módulo inexistente.
//
// --- Contrato exacto que debe cumplir la implementación (documentado en el informe final) ---
// `useMediaQuery(query: string): boolean`. Debe llamar `window.matchMedia(query)` una vez,
// leer `.matches` para el valor inicial, y suscribirse al MediaQueryList con la API MODERNA
// `addEventListener('change', listener)` (no el `addListener` legado y deprecado) para
// reaccionar a cambios de tamaño de ventana en caliente, actualizando su estado y
// re-renderizando. El listener recibe un evento con `.matches` (forma de
// `MediaQueryListEvent`).

type ChangeListener = (event: { matches: boolean }) => void;

function createMatchMediaMock(initialMatches: boolean) {
  let currentMatches = initialMatches;
  const listeners = new Set<ChangeListener>();

  const mediaQueryList = {
    get matches() {
      return currentMatches;
    },
    media: '',
    addEventListener: vi.fn((event: string, listener: ChangeListener) => {
      if (event === 'change') {
        listeners.add(listener);
      }
    }),
    removeEventListener: vi.fn((event: string, listener: ChangeListener) => {
      if (event === 'change') {
        listeners.delete(listener);
      }
    }),
  };

  function emitChange(nextMatches: boolean) {
    currentMatches = nextMatches;
    listeners.forEach((listener) => listener({ matches: nextMatches }));
  }

  return { mediaQueryList, emitChange };
}

describe('useMediaQuery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when window.matchMedia reports matches: true for the given query', () => {
    const { mediaQueryList } = createMatchMediaMock(true);
    const matchMedia = vi.fn().mockReturnValue(mediaQueryList);
    vi.stubGlobal('matchMedia', matchMedia);

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));

    expect(result.current).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 768px)');
  });

  it('returns false when window.matchMedia reports matches: false for the given query', () => {
    const { mediaQueryList } = createMatchMediaMock(false);
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mediaQueryList));

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));

    expect(result.current).toBe(false);
  });

  it('updates its value and re-renders when the MediaQueryList fires a "change" event', () => {
    const { mediaQueryList, emitChange } = createMatchMediaMock(false);
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mediaQueryList));

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));

    expect(result.current).toBe(false);
    // Verifica explícitamente que se usa la API moderna (`addEventListener`), no `addListener`.
    expect(mediaQueryList.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    act(() => {
      emitChange(true);
    });

    expect(result.current).toBe(true);

    act(() => {
      emitChange(false);
    });

    expect(result.current).toBe(false);
  });
});

// NUT-20 (novena iteración, tester) — Hallazgo 1 (crítico): revisión de la adaptación desktop.
// Hoy el hook llama `window.matchMedia(query).matches` sin validar que `window.matchMedia` sea
// una función. En un navegador viejo/entorno raro donde `window.matchMedia` no existe (o vino
// reemplazado por `undefined`), esa llamada tira un `TypeError` durante el render — y como la
// app no tiene ningún `ErrorBoundary`, eso deja la pantalla completa en blanco, no sólo esta
// pantalla de recetas. La corrección esperada (implementer): validar
// `typeof window.matchMedia === 'function'` antes de llamarlo, devolviendo `false` (mobile)
// como fallback seguro tanto en el valor inicial como en el efecto de suscripción (sin
// intentar suscribirse si la función no existe). Se espera ROJO hoy: la implementación actual
// no tiene esa guarda y el `TypeError` se propaga sin capturarse.
describe('useMediaQuery — Hallazgo 1 (crítico, novena iteración): window.matchMedia ausente', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not throw and falls back to false when window.matchMedia has been replaced by undefined', () => {
    vi.stubGlobal('matchMedia', undefined);

    let result: { current: boolean } | undefined;

    expect(() => {
      ({ result } = renderHook(() => useMediaQuery('(min-width: 768px)')));
    }).not.toThrow();

    expect(result?.current).toBe(false);
  });

  it('does not throw and falls back to false when window.matchMedia has been deleted entirely', () => {
    const originalMatchMedia = window.matchMedia;
    // @ts-expect-error borrado deliberado: simula un navegador/entorno que nunca implementó
    // `window.matchMedia`, distinto del caso de arriba (reemplazado por `undefined` explícito).
    delete window.matchMedia;

    let result: { current: boolean } | undefined;

    try {
      expect(() => {
        ({ result } = renderHook(() => useMediaQuery('(min-width: 768px)')));
      }).not.toThrow();

      expect(result?.current).toBe(false);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  // Caso de control (no-regresión): con `matchMedia` presente y funcionando, el comportamiento
  // ya testeado arriba (returns true/false según `.matches`, se suscribe con
  // `addEventListener('change', ...)`) sigue exactamente igual — no repetido acá para no
  // duplicar los tests ya existentes en este mismo archivo, que ya lo cubren.
});
