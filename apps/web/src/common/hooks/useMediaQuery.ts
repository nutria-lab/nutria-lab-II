import { useEffect, useState } from 'react';

// Hook GENÉRICO sobre `window.matchMedia`, sin ningún breakpoint fijo (design.md sección 9.2 —
// el breakpoint concreto lo decide quien consume el hook, p. ej. `(min-width: 768px)`, el mismo
// `md:` ya usado por `Sidebar.tsx`/`AppLayout.tsx`/`BottomNavigation.tsx`). Se suscribe con la
// API moderna `addEventListener('change', ...)` (no el `addListener` legado) para reaccionar a
// cambios de tamaño de ventana en caliente.
// Hallazgo 1 (crítico, novena iteración): en un entorno/navegador donde `window.matchMedia`
// no existe (o vino reemplazado por `undefined`), llamarlo directamente tira un `TypeError`
// durante el render y, al no haber `ErrorBoundary`, deja la pantalla completa en blanco. Se
// valida su presencia antes de cada uso, con `false` (mobile) como fallback seguro.
function supportsMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (supportsMatchMedia() ? window.matchMedia(query).matches : false));

  useEffect(() => {
    if (!supportsMatchMedia()) {
      setMatches(false);
      return;
    }

    const mediaQueryList = window.matchMedia(query);
    setMatches(mediaQueryList.matches);

    function handleChange(event: MediaQueryListEvent) {
      setMatches(event.matches);
    }

    mediaQueryList.addEventListener('change', handleChange);
    return () => {
      mediaQueryList.removeEventListener('change', handleChange);
    };
  }, [query]);

  return matches;
}
