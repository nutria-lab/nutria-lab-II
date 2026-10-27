import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../features/auth/AuthProvider';
import { DashboardView } from '../components/DashboardView';
import { buildUnavailableViewModel } from '../utils';

// Los fixtures de ?estado son solo de desarrollo. Se cargan con import() dinámico porque Vite
// reemplaza import.meta.env.DEV por false en producción y elimina esta rama: ni el código ni los
// datos de ejemplo llegan al bundle (un import estático los filtraría). DEV se vuelve a comprobar
// al renderizar porque el entorno puede cambiarse después de cargar el módulo (p. ej. en tests);
// fuera de desarrollo siempre se muestra el estado no disponible.
const devFixtures = import.meta.env.DEV ? await import('../fixtures') : null;

const DEV_RETRY_DELAY_MS = 800;

// Solo desarrollo: simula la recuperación (?estado=loading y luego ?estado=comidas) para que el PO
// valide el camino completo. El timer se limpia al reprogramar y al desmontar.
function useDevFixtureRetry(): () => void {
  const [, setSearchParams] = useSearchParams();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  return useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setSearchParams({ estado: 'loading' });
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setSearchParams({ estado: 'comidas' });
    }, DEV_RETRY_DELAY_MS);
  }, [setSearchParams]);
}

export function DashboardPage() {
  const userName = useAuth().user?.name ?? null;
  const [searchParams] = useSearchParams();
  const retryFixture = useDevFixtureRetry();

  const fixture =
    import.meta.env.DEV && devFixtures
      ? devFixtures.selectDashboardFixture(searchParams.get('estado'), userName, retryFixture)
      : null;
  const viewModel = fixture ?? buildUnavailableViewModel(userName);

  return <DashboardView viewModel={viewModel} />;
}
