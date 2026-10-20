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

export function DashboardPage() {
  const userName = useAuth().user?.name ?? null;
  const [searchParams] = useSearchParams();

  const fixture =
    import.meta.env.DEV && devFixtures ? devFixtures.selectDashboardFixture(searchParams.get('estado'), userName) : null;
  const viewModel = fixture ?? buildUnavailableViewModel(userName);

  return <DashboardView viewModel={viewModel} />;
}
