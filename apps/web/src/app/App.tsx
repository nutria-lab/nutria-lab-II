import { useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AppLayout } from '../common/components/AppLayout';
import { PlaceholderPage } from '../common/components/PlaceholderPage';
import { LoginPage, type LoginPageStatus, type LoginSubmission } from '../features/auth/LoginPage';
import { PreferencesPage } from '../modules/profile/pages/PreferencesPage';
import { authService, LoginRequestError } from '../services/authService';

function LoginRoute() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<LoginPageStatus>('idle');
  const isMountedRef = useRef(true);
  const loginInFlightRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function handleLogin(credentials: LoginSubmission) {
    if (loginInFlightRef.current) {
      return;
    }

    loginInFlightRef.current = true;
    setStatus('loading');

    try {
      await authService.login(credentials);

      if (!isMountedRef.current) {
        return;
      }

      loginInFlightRef.current = false;
      navigate('/goals');
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      loginInFlightRef.current = false;
      setStatus(error instanceof LoginRequestError && error.kind === 'invalidCredentials'
        ? 'invalidCredentials'
        : 'networkError');
    }
  }

  return (
    <LoginPage
      status={status}
      onSubmit={handleLogin}
      onCredentialsChange={() => {
        if (!loginInFlightRef.current) {
          setStatus('idle');
        }
      }}
    />
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route
        path="*"
        element={(
          <AppLayout>
            <Routes>
              <Route path="/" element={<Navigate to="/goals" replace />} />
              <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
              <Route path="/meal-plan" element={<PlaceholderPage title="Meal Plan" />} />
              <Route path="/recipes" element={<PlaceholderPage title="Recipes" />} />
              <Route path="/shopping-list" element={<PlaceholderPage title="Shopping List" />} />
              <Route path="/goals" element={<PreferencesPage />} />
            </Routes>
          </AppLayout>
        )}
      />
    </Routes>
  );
}
