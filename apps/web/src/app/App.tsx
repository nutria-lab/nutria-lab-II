import { useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppLayout } from '../common/components/AppLayout';
import { PlaceholderPage } from '../common/components/PlaceholderPage';
import { AuthProvider, useAuth } from '../features/auth/AuthProvider';
import { LoginPage, type LoginPageStatus, type LoginSubmission } from '../features/auth/LoginPage';
import { RegistrationPage } from '../features/auth/RegistrationPage';
import { PreferencesPage } from '../modules/profile/pages/PreferencesPage';
import { LoginRequestError } from '../services/authService';
import { MealPlanPage } from '../modules/meal-plan/pages/MealPlanPage';

function LoginRoute() {
  const { status: authStatus, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<LoginPageStatus>('idle');
  const intendedPath = (location.state as { from?: { pathname?: string } } | null)
    ?.from?.pathname;
  const destination = intendedPath?.startsWith('/') && !intendedPath.startsWith('//')
    ? intendedPath
    : '/goals';

  if (authStatus === 'authenticated') return <Navigate replace to={destination} />;

  async function handleLogin(credentials: LoginSubmission) {
    if (authStatus !== 'anonymous' || status === 'loading') {
      return;
    }

    setStatus('loading');

    try {
      const accepted = await login(credentials.email, credentials.password);
      if (accepted) {
        navigate(destination);
        return;
      }
    } catch (error) {
      setStatus(error instanceof LoginRequestError && error.kind === 'invalidCredentials'
        ? 'invalidCredentials'
        : 'networkError');
      return;
    }

    setStatus('idle');
  }

  return (
    <LoginPage
      status={authStatus === 'initializing' ? 'restoring' : status}
      onSubmit={handleLogin}
      onCredentialsChange={() => {
        setStatus((currentStatus) => currentStatus === 'loading' ? currentStatus : 'idle');
      }}
    />
  );
}

function ProtectedApp({ children }: { children: ReactNode }) {
  const { status, logout } = useAuth();
  const location = useLocation();
  if (status === 'initializing') return <main role="status" aria-label="Comprobando sesión">Comprobando sesión…</main>;
  if (status === 'anonymous') return <Navigate replace to="/login" state={{ from: location }} />;
  return <AppLayout onLogout={logout}>{children}</AppLayout>;
}

export function App() {
  return (
    <AuthProvider><Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/register" element={<RegistrationPage />} />
      <Route
        path="*"
        element={(
          <ProtectedApp>
            <Routes>
              <Route path="/" element={<Navigate to="/goals" replace />} />
              <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
              <Route path="/meal-plan" element={<MealPlanPage />} />
              <Route path="/recipes" element={<PlaceholderPage title="Recipes" />} />
              <Route path="/shopping-list" element={<PlaceholderPage title="Shopping List" />} />
              <Route path="/goals" element={<PreferencesPage />} />
            </Routes>
          </ProtectedApp>
        )}
      />
    </Routes></AuthProvider>
  );
}
