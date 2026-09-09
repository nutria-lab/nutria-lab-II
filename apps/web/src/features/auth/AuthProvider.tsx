import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { setAuthFailureHandler } from '../../services/apiClient';
import { authService, type AuthenticatedUser } from '../../services/authService';

export type AuthStatus = 'initializing' | 'authenticated' | 'anonymous';

type AuthValue = {
  status: AuthStatus;
  user: AuthenticatedUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('initializing');
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const invalidatingRef = useRef(false);
  const restorationVersionRef = useRef(0);
  const restorationPromiseRef = useRef<Promise<AuthenticatedUser> | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location);
  const navigateRef = useRef(navigate);

  locationRef.current = location;
  navigateRef.current = navigate;

  const invalidate = useCallback(async () => {
    if (invalidatingRef.current) {
      return;
    }

    invalidatingRef.current = true;
    restorationVersionRef.current += 1;
    setUser(null);
    setStatus('anonymous');
    void authService.logout();

    if (!locationRef.current.pathname.startsWith('/login')) {
      navigateRef.current('/login', { replace: true });
    }
  }, []);

  useEffect(() => {
    let isActive = true;
    const restorationVersion = restorationVersionRef.current;
    const restoration = restorationPromiseRef.current
      ?? authService.getCurrentUser();

    restorationPromiseRef.current = restoration;

    void restoration
      .then((next) => {
        if (isActive && restorationVersion === restorationVersionRef.current) {
          setUser(next);
          setStatus('authenticated');
        }
      })
      .catch(() => {
        if (isActive && restorationVersion === restorationVersionRef.current) {
          setStatus('anonymous');
        }
      });

    setAuthFailureHandler(invalidate);

    return () => {
      isActive = false;
      setAuthFailureHandler(null);
    };
  }, [invalidate]);

  const login = async (email: string, password: string) => {
    const next = await authService.login({ email, password });
    invalidatingRef.current = false;
    restorationVersionRef.current += 1;
    setUser(next);
    setStatus('authenticated');
  };

  const logout = async () => {
    await invalidate();
  };

  return <AuthContext.Provider value={{ status, user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return value;
}
