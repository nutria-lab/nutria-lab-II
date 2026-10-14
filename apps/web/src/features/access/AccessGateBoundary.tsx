import { useEffect, useState, type ReactNode } from 'react';

import {
  AccessGateRequestError,
  accessGateService,
} from '../../services/accessGateService';
import { AccessGatePage, type AccessGatePageStatus } from './AccessGatePage';

type AccessGateBoundaryProps = {
  children: ReactNode;
};

type GateState = 'checking' | 'required' | 'unlocked';

export function AccessGateBoundary({ children }: AccessGateBoundaryProps) {
  const [state, setState] = useState<GateState>('checking');
  const [pageStatus, setPageStatus] = useState<AccessGatePageStatus>('idle');
  const [checkAttempt, setCheckAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState('checking');
    setPageStatus('idle');

    void accessGateService.getStatus(controller.signal)
      .then((status) => {
        if (controller.signal.aborted) return;
        setState(status.required && !status.unlocked ? 'required' : 'unlocked');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState('required');
        setPageStatus('networkError');
      });

    return () => controller.abort();
  }, [checkAttempt]);

  async function handleSubmit(password: string) {
    setPageStatus('loading');
    try {
      await accessGateService.verify(password);
      setState('unlocked');
      setPageStatus('idle');
    } catch (error) {
      setPageStatus(error instanceof AccessGateRequestError && error.kind === 'invalidPassword'
        ? 'invalidPassword'
        : 'networkError');
    }
  }

  function retryStatusCheck() {
    setCheckAttempt((attempt) => attempt + 1);
  }

  if (state === 'checking') {
    return (
      <main className="flex min-h-dvh w-full items-center justify-center bg-brand-cream px-4">
        <p aria-label="Comprobando acceso" className="text-on-surface-variant" role="status">
          Comprobando acceso…
        </p>
      </main>
    );
  }

  if (state === 'required') {
    return (
      <AccessGatePage
        status={pageStatus}
        onSubmit={handleSubmit}
        onRetry={retryStatusCheck}
        onPasswordChange={() => {
          if (pageStatus === 'invalidPassword') setPageStatus('idle');
        }}
      />
    );
  }

  return <>{children}</>;
}