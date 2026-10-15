import { type FormEvent, useRef, useState } from 'react';

import { BrandMark } from '../../common/components/BrandMark';

export type AccessGatePageStatus = 'idle' | 'loading' | 'invalidPassword' | 'networkError';

type AccessGatePageProps = {
  status?: AccessGatePageStatus;
  onSubmit?: (password: string) => void | Promise<void>;
  onRetry?: () => void;
  onPasswordChange?: () => void;
};

export function AccessGatePage({
  status = 'idle',
  onSubmit,
  onRetry,
  onPasswordChange,
}: AccessGatePageProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [hasLocalError, setHasLocalError] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const isLoading = status === 'loading';
  const isBusy = isLoading;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) return;

    if (!password) {
      setHasLocalError(true);
      passwordRef.current?.focus();
      return;
    }

    if (status === 'networkError') {
      onRetry?.();
      return;
    }

    void onSubmit?.(password);
  }

  function handlePasswordChange(nextPassword: string) {
    setPassword(nextPassword);
    setHasLocalError(false);
    onPasswordChange?.();
  }

  const showError = hasLocalError || status === 'invalidPassword';

  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center bg-brand-cream px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 h-72 w-72 -translate-y-1/3 translate-x-1/3 rounded-full bg-primary-container/20 blur-3xl"
      />

      <section
        aria-labelledby="access-gate-title"
        className="relative w-full max-w-md rounded-2xl border border-outline-variant/30 bg-surface-container-low p-8 shadow-[0_4px_20px_rgba(46,50,48,0.08)]"
      >
        <div className="mb-6 flex justify-center">
          <BrandMark variant="auth" />
        </div>

        <header className="mb-8 text-center">
          <h1 id="access-gate-title" className="font-headline text-3xl font-bold text-brand-green">
            Acceso privado
          </h1>
          <p className="mt-2 leading-relaxed text-on-surface-variant">
            Ingresá la contraseña para continuar a NutrIA.
          </p>
        </header>

        <form className="space-y-6" noValidate aria-busy={isBusy || undefined} onSubmit={handleSubmit}>
          {status === 'invalidPassword' && (
            <p
              className="rounded-lg border-l-4 border-error bg-error-container/30 p-3 text-sm text-on-error-container"
              role="alert"
            >
              La contraseña no es correcta.
            </p>
          )}
          {status === 'networkError' && (
            <div
              className="rounded-lg border-l-4 border-error bg-error-container/30 p-3 text-sm text-on-error-container"
              role="alert"
            >
              <p>No pudimos validar el acceso. Revisá tu conexión e intentá nuevamente.</p>
              <button
                className="mt-2 inline-flex min-h-11 cursor-pointer items-center bg-transparent py-2 font-extrabold text-inherit underline underline-offset-[0.18em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
                type="button"
                onClick={onRetry}
              >
                Reintentar
              </button>
            </div>
          )}
          {hasLocalError && (
            <p
              className="rounded-lg border-l-4 border-error bg-error-container/30 p-3 text-sm text-on-error-container"
              role="alert"
            >
              Ingresá la contraseña de acceso.
            </p>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-on-surface" htmlFor="access-password">
              Contraseña de acceso
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-outline">
                <span aria-hidden="true" className="material-symbols-outlined text-xl">lock</span>
              </div>
              <input
                ref={passwordRef}
                autoFocus
                className="w-full rounded-lg border border-outline-variant/50 bg-white py-3 pl-12 pr-14 text-on-surface shadow-sm transition-all focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/20 aria-invalid:border-error disabled:opacity-60"
                id="access-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                required
                value={password}
                disabled={isBusy}
                aria-invalid={showError ? 'true' : undefined}
                aria-describedby={showError ? 'access-password-error' : undefined}
                onChange={(event) => handlePasswordChange(event.target.value)}
              />
              <button
                className="absolute inset-y-0 right-0 flex min-h-12 items-center px-4 text-outline transition-colors hover:text-brand-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green disabled:opacity-60"
                type="button"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
                disabled={isBusy}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-xl">
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
            {showError && (
              <p className="text-sm text-error" id="access-password-error">
                {hasLocalError ? 'Ingresá la contraseña de acceso.' : 'La contraseña no es correcta.'}
              </p>
            )}
          </div>

          <button
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green py-4 font-bold text-on-primary shadow-sm transition-all duration-300 hover:opacity-90 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
            disabled={isBusy}
            type="submit"
          >
            {isLoading && (
              <span
                aria-hidden="true"
                className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
              />
            )}
            <span className="material-symbols-outlined text-xl" aria-hidden="true">
              arrow_forward
            </span>
            {isLoading ? 'Validando acceso...' : status === 'networkError' ? 'Reintentar' : 'Continuar'}
          </button>
          {isLoading && (
            <span aria-label="Validando acceso..." className="sr-only" role="status">
              Validando acceso...
            </span>
          )}
        </form>
      </section>
    </main>
  );
}