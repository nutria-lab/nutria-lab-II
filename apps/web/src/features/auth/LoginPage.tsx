import { type FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { BrandMark } from '../../common/components/BrandMark';
import { validateLoginFields, type LoginFieldErrors } from './loginValidation';

export type LoginPageStatus = 'idle' | 'restoring' | 'loading' | 'invalidCredentials' | 'networkError';

export type LoginSubmission = {
  email: string;
  password: string;
};

type LoginPageProps = {
  /** Visual-only state supplied by the login request boundary. */
  status?: LoginPageStatus;
  onSubmit?: (credentials: LoginSubmission) => void | Promise<void>;
  onCredentialsChange?: (credentials: LoginSubmission) => void;
};

export function LoginPage({ status = 'idle', onSubmit, onCredentialsChange }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<LoginFieldErrors>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const isLoading = status === 'loading';
  const isRestoring = status === 'restoring';
  const isBusy = isLoading || isRestoring;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) return;
    submitValidCredentials();
  }

  function submitValidCredentials() {
    const nextErrors = validateLoginFields(email, password);
    setErrors(nextErrors);
    if (nextErrors.email) {
      emailRef.current?.focus();
    } else if (nextErrors.password) {
      passwordRef.current?.focus();
    } else {
      void onSubmit?.({ email, password });
    }
  }

  function handleRetry() {
    if (!isBusy) submitValidCredentials();
  }

  function handleEmailChange(nextEmail: string) {
    setEmail(nextEmail);
    onCredentialsChange?.({ email: nextEmail, password });
    if (errors.email) {
      setErrors((current) => {
        const { email: _e, ...rest } = current;
        return rest;
      });
    }
  }

  function handlePasswordChange(nextPassword: string) {
    setPassword(nextPassword);
    onCredentialsChange?.({ email, password: nextPassword });
    if (errors.password) {
      setErrors((current) => {
        const { password: _p, ...rest } = current;
        return rest;
      });
    }
  }

  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center bg-brand-cream px-4 py-10">
      {/* Decorative ambient blob */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 h-72 w-72 -translate-y-1/3 translate-x-1/3 rounded-full bg-primary-container/20 blur-3xl"
      />

      {/* Card */}
      <section
        aria-labelledby="login-title"
        className="relative w-full max-w-md rounded-2xl border border-outline-variant/30 bg-surface-container-low p-8 shadow-[0_4px_20px_rgba(46,50,48,0.08)]"
      >
        {/* Brand */}
        <div className="mb-6 flex justify-center">
          <BrandMark variant="auth" />
        </div>

        <header className="mb-8 text-center">
          <h1 id="login-title" className="font-headline text-3xl font-bold text-brand-green">
            Iniciá sesión
          </h1>
          <p className="mt-2 leading-relaxed text-on-surface-variant">
            Ingresá tus datos para continuar
          </p>
        </header>

        <form className="space-y-6" noValidate aria-busy={isBusy || undefined} onSubmit={handleSubmit}>
          {/* Alerts */}
          {status === 'invalidCredentials' && (
            <p
              className="rounded-lg border-l-4 border-error bg-error-container/30 p-3 text-sm text-on-error-container"
              role="alert"
            >
              El correo o la contraseña no son correctos.
            </p>
          )}
          {status === 'networkError' && (
            <div
              className="rounded-lg border-l-4 border-error bg-error-container/30 p-3 text-sm text-on-error-container"
              role="alert"
            >
              <p>No pudimos iniciar sesión. Revisá tu conexión e intentá nuevamente.</p>
              <button
                className="mt-2 inline-flex min-h-11 cursor-pointer items-center bg-transparent py-2 font-extrabold text-inherit underline underline-offset-[0.18em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
                type="button"
                onClick={handleRetry}
              >
                Reintentar
              </button>
            </div>
          )}
          {Object.keys(errors).length > 0 && (
            <div
              className="rounded-lg border-l-4 border-error bg-error-container/30 p-3 text-sm text-on-error-container"
              role="alert"
            >
              {Object.values(errors).join(' ')}
            </div>
          )}

          {/* Email */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-on-surface" htmlFor="email">
              Correo electrónico
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-outline">
                <span aria-hidden="true" className="material-symbols-outlined text-xl">mail</span>
              </div>
              <input
                ref={emailRef}
                className="w-full rounded-lg border border-outline-variant/50 bg-white py-3 pl-12 pr-4 text-on-surface shadow-sm transition-all placeholder:text-on-surface-variant/50 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/20 aria-invalid:border-error disabled:opacity-60"
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                placeholder="tu@correo.com"
                required
                value={email}
                disabled={isRestoring}
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={errors.email ? 'email-error' : undefined}
                onChange={(event) => handleEmailChange(event.target.value)}
              />
            </div>
            {errors.email && (
              <p className="text-sm text-error" id="email-error">
                {errors.email}
              </p>
            )}
          </div>

          {/* Password */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-semibold text-on-surface" htmlFor="current-password">
                Contraseña
              </label>
              <button
                className="text-sm font-semibold text-brand-green transition-colors hover:text-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green disabled:opacity-60"
                type="button"
                disabled={isRestoring}
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-outline">
                <span aria-hidden="true" className="material-symbols-outlined text-xl">lock</span>
              </div>
              <input
                ref={passwordRef}
                className="w-full rounded-lg border border-outline-variant/50 bg-white py-3 pl-12 pr-14 text-on-surface shadow-sm transition-all focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/20 aria-invalid:border-error disabled:opacity-60"
                id="current-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                required
                value={password}
                disabled={isRestoring}
                aria-invalid={errors.password ? 'true' : undefined}
                aria-describedby={errors.password ? 'password-error' : undefined}
                onChange={(event) => handlePasswordChange(event.target.value)}
              />
              <button
                className="absolute inset-y-0 right-0 flex min-h-12 items-center px-4 text-outline transition-colors hover:text-brand-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green disabled:opacity-60"
                type="button"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
                disabled={isRestoring}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-xl">
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
            {errors.password && (
              <p className="text-sm text-error" id="password-error">
                {errors.password}
              </p>
            )}
          </div>

          {/* Remember me */}
          <div className="flex items-center gap-2">
            <input
              id="remember"
              name="remember"
              type="checkbox"
              disabled={isRestoring}
              className="h-4 w-4 rounded border-outline-variant text-brand-green focus:ring-brand-green disabled:opacity-50"
            />
            <label htmlFor="remember" className="text-sm text-on-surface-variant">
              Recordarme
            </label>
          </div>

          {/* Submit */}
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
            {isLoading ? 'Iniciando sesión...' : 'Iniciá sesión'}
          </button>
          {isLoading && (
            <span aria-label="Iniciando sesión..." className="sr-only" role="status">
              Iniciando sesión...
            </span>
          )}
        </form>

        {/* Footer */}
        <p className="mt-8 text-center text-sm text-on-surface-variant">
          ¿No tenés cuenta? <Link
            aria-disabled={isRestoring || undefined}
            className="font-bold text-brand-green underline-offset-4 transition-colors hover:text-tertiary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            onClick={isRestoring ? (event) => event.preventDefault() : undefined}
            tabIndex={isRestoring ? -1 : undefined}
            to="/register"
          >
            Registrate
          </Link>
        </p>
      </section>
    </main>
  );
}
