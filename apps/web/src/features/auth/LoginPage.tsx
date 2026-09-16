import { type FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { BrandMark } from '../../common/components/BrandMark';
import { validateLoginFields, type LoginFieldErrors } from './loginValidation';

function OutlineLeaf() {
  return (
    <svg
      aria-hidden="true"
      className="w-28 fill-none stroke-[#fffdf8] stroke-[1.5] [stroke-linecap:round] [stroke-linejoin:round] md:w-[8.25rem] md:stroke-[1.3]"
      viewBox="0 0 128 128"
    >
      <path d="M99 15C84 34 66 40 47 48 25 57 15 75 25 101c9-22 26-38 49-47 17-7 26-20 25-39Z" />
      <path d="M25 101c16-23 34-39 74-86" />
    </svg>
  );
}

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

    if (isBusy) {
      return;
    }

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
    if (!isBusy) {
      submitValidCredentials();
    }
  }

  function handleEmailChange(nextEmail: string) {
    setEmail(nextEmail);
    onCredentialsChange?.({ email: nextEmail, password });

    if (errors.email) {
      setErrors((currentErrors) => {
        const { email: _emailError, ...remainingErrors } = currentErrors;
        return remainingErrors;
      });
    }
  }

  function handlePasswordChange(nextPassword: string) {
    setPassword(nextPassword);
    onCredentialsChange?.({ email, password: nextPassword });

    if (errors.password) {
      setErrors((currentErrors) => {
        const { password: _passwordError, ...remainingErrors } = currentErrors;
        return remainingErrors;
      });
    }
  }

  return (
    <main className="min-h-dvh w-full bg-[#f7f1e5] md:grid md:grid-cols-2">
      <aside className="hidden min-h-dvh items-center justify-center bg-[#b58c43] p-12 text-[#fffdf8] md:flex" aria-hidden="true">
        <div className="flex max-w-sm flex-col items-center text-center">
          <OutlineLeaf />
          <p className="mt-8 font-serif text-xl leading-7">Nutrirte bien empieza con elegir con intención.</p>
        </div>
      </aside>

      <section
        className="grid min-h-dvh w-full place-items-center bg-[#f7f1e5] px-6 py-10 md:px-[clamp(2.5rem,7vw,7rem)] md:py-12"
        aria-labelledby="login-title"
      >
        <div className="w-full max-w-[25rem] md:max-w-[23rem]">
          <BrandMark variant="auth" />

          <header className="mb-7 text-center">
            <h1 id="login-title" className="m-0 font-serif text-[clamp(2rem,8vw,2.35rem)] font-semibold leading-[1.15] tracking-[-0.025em] text-[#254a36] md:text-4xl">
              Iniciá sesión
            </h1>
            <p className="mt-2.5 leading-6 text-[#5f675c]">Ingresá tus datos para continuar</p>
          </header>

          <form className="grid gap-[1.1rem]" noValidate aria-busy={isBusy || undefined} onSubmit={handleSubmit}>
            {status === 'invalidCredentials' && (
              <p className="m-0 rounded-lg border-l-4 border-[#9e2f27] bg-[#fff1ee] p-3 text-[#6d211c]" role="alert">
                El correo o la contraseña no son correctos.
              </p>
            )}
            {status === 'networkError' && (
              <div className="m-0 rounded-lg border-l-4 border-[#9e2f27] bg-[#fff1ee] p-3 text-[#6d211c]" role="alert">
                <p className="m-0">No pudimos iniciar sesión. Revisá tu conexión e intentá nuevamente.</p>
                <button
                  className="mt-2 inline-flex min-h-11 cursor-pointer items-center bg-transparent py-2 font-extrabold text-inherit underline underline-offset-[0.18em] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#c88b35]"
                  type="button"
                  onClick={handleRetry}
                >
                  Reintentar
                </button>
              </div>
            )}
            {Object.keys(errors).length > 0 && (
              <div className="rounded-lg border-l-4 border-[#9e2f27] bg-[#fff1ee] p-3 text-[#6d211c]" role="alert">
                {Object.values(errors).join(' ')}
              </div>
            )}
            <div className="grid gap-2">
              <label className="text-sm font-bold" htmlFor="email">Correo electrónico</label>
              <input
                ref={emailRef}
                className="min-h-12 w-full rounded-lg border border-[#b7b7a8] bg-[#fffefa] px-3 py-2.5 pr-3 aria-invalid:border-[#9e2f27] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#c88b35]"
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                disabled={isRestoring}
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={errors.email ? 'email-error' : undefined}
                onChange={(event) => handleEmailChange(event.target.value)}
              />
              {errors.email && <p className="m-0 text-[#9e2f27]" id="email-error">{errors.email}</p>}
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-bold" htmlFor="current-password">Contraseña</label>
              <div className="relative">
                <input
                  ref={passwordRef}
                  className="min-h-12 w-full rounded-lg border border-[#b7b7a8] bg-[#fffefa] px-3 py-2.5 pr-[5.5rem] aria-invalid:border-[#9e2f27] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#c88b35]"
                  id="current-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  disabled={isRestoring}
                  aria-invalid={errors.password ? 'true' : undefined}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  onChange={(event) => handlePasswordChange(event.target.value)}
                />
                <button
                  className="absolute top-0.5 right-0.5 min-h-11 rounded-md border-0 bg-transparent px-3 py-2 text-sm font-bold text-[#254a36] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#c88b35]"
                  type="button"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword}
                  disabled={isRestoring}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              {errors.password && <p className="m-0 text-[#9e2f27]" id="password-error">{errors.password}</p>}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 gap-y-2.5">
              <label className="flex min-h-11 items-center gap-2.5 text-sm font-bold" htmlFor="remember-me">
                <input
                  className="size-5 accent-[#254a36] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#c88b35]"
                  id="remember-me"
                  name="rememberMe"
                  type="checkbox"
                  disabled={isRestoring}
                />
                <span>Recordarme</span>
              </label>
              <button
                className="inline-flex min-h-11 cursor-pointer items-center border-0 bg-transparent py-2 text-sm font-bold text-[#254a36] underline underline-offset-[0.18em] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#c88b35]"
                type="button"
                disabled={isRestoring}
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            <button
              className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-[#254a36] px-4 py-3 font-extrabold text-[#fffdf8] disabled:cursor-wait disabled:bg-[#345b45] disabled:opacity-100 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#c88b35]"
              disabled={isBusy}
              type="submit"
            >
              {isLoading && <span aria-hidden="true" className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />}
              {isLoading ? 'Iniciando sesión...' : 'Iniciá sesión'}
            </button>
            {isLoading && <span aria-label="Iniciando sesión..." className="sr-only" role="status">Iniciando sesión...</span>}
          </form>

          <p className="mx-auto mt-7 text-center text-sm text-[#5f675c]">
            ¿No tenés cuenta? <Link
              aria-disabled={isRestoring || undefined}
              className="font-bold text-[#254a36] underline underline-offset-[0.18em] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#c88b35] aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
              onClick={isRestoring ? (event) => event.preventDefault() : undefined}
              tabIndex={isRestoring ? -1 : undefined}
              to="/register"
            >Registrate</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
