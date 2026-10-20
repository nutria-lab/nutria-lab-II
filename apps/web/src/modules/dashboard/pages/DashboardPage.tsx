import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../features/auth/AuthProvider';
import { DashboardView } from '../components/DashboardView';
import { selectDashboardFixture } from '../fixtures';
import { buildUnavailableViewModel } from '../utils';

export function DashboardPage() {
  const userName = useAuth().user?.name ?? null;
  const [searchParams] = useSearchParams();

  // Los fixtures de ?estado solo se usan en desarrollo; en otro caso, estado no disponible.
  const fixture = import.meta.env.DEV ? selectDashboardFixture(searchParams.get('estado'), userName) : null;
  const viewModel = fixture ?? buildUnavailableViewModel(userName);

  return <DashboardView viewModel={viewModel} />;
}
