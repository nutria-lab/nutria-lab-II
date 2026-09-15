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
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('initializing');
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const invalidatingRef = useRef(false);
  const sessionVersionRef = useRef(0);
  const restorationPromiseRef = useRef<Promise<AuthenticatedUser> | null>(null);
  const loginPromiseRef = useRef<Promise<boolean> | null>(null);
  const sessionMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionMutationPendingRef = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location);
  const navigateRef = useRef(navigate);

  locationRef.current = location;
  navigateRef.current = navigate;

  const enqueueSessionMutation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    if (!sessionMutationPendingRef.current) {
      let mutation: Promise<T>;

      try {
        mutation = operation();
      } catch (error) {
        mutation = Promise.reject(error);
      }

      sessionMutationPendingRef.current = true;
      const tail = mutation.then(() => undefined, () => undefined);
      sessionMutationQueueRef.current = tail;
      void tail.finally(() => {
        if (sessionMutationQueueRef.current === tail) {
          sessionMutationPendingRef.current = false;
        }
      });
      return mutation;
    }

    const queued = sessionMutationQueueRef.current.then(operation, operation);
    const tail = queued.then(() => undefined, () => undefined);
    sessionMutationQueueRef.current = tail;
    return queued;
  }, []);

  const invalidate = useCallback(async () => {
    if (invalidatingRef.current) {
      return;
    }

    invalidatingRef.current = true;
    sessionVersionRef.current += 1;
    setUser(null);
    setStatus('anonymous');

    if (!locationRef.current.pathname.startsWith('/login')) {
      navigateRef.current('/login', { replace: true });
    }

    await enqueueSessionMutation(() => authService.logout());
  }, [enqueueSessionMutation]);

  useEffect(() => {
    let isActive = true;
    const restorationVersion = sessionVersionRef.current;
    const restoration = restorationPromiseRef.current
      ?? authService.getCurrentUser();

    restorationPromiseRef.current = restoration;

    void restoration
      .then((next) => {
        if (isActive && restorationVersion === sessionVersionRef.current) {
          setUser(next);
          setStatus('authenticated');
        }
      })
      .catch(() => {
        if (isActive && restorationVersion === sessionVersionRef.current) {
          setStatus('anonymous');
        }
      });

    setAuthFailureHandler(invalidate);

    return () => {
      isActive = false;
      setAuthFailureHandler(null);
    };
  }, [invalidate]);

  const login = useCallback((email: string, password: string) => {
    if (loginPromiseRef.current) {
      return loginPromiseRef.current;
    }

    const loginVersion = sessionVersionRef.current + 1;
    sessionVersionRef.current = loginVersion;
    const loginPromise = enqueueSessionMutation(async () => {
      const next = await authService.login({ email, password });

      if (loginVersion === sessionVersionRef.current) {
        invalidatingRef.current = false;
        setUser(next);
        setStatus('authenticated');
        return true;
      }

      return false;
    });

    loginPromiseRef.current = loginPromise;
    void loginPromise.then(() => {
      if (loginPromiseRef.current === loginPromise) {
        loginPromiseRef.current = null;
      }
    }, () => {
      if (loginPromiseRef.current === loginPromise) {
        loginPromiseRef.current = null;
      }
    });

    return loginPromise;
  }, [enqueueSessionMutation]);

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
