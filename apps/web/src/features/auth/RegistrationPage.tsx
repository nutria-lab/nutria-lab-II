import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { BrandMark } from '../../common/components/BrandMark';
import { RegisterRequestError, registerService, type RegisterErrorKind } from '../../services/registerService';
import {
  MINIMUM_PASSWORD_LENGTH,
  type RegistrationFieldErrors,
  type RegistrationValues,
  validateRegistrationFields,
} from './registrationValidation';

type RegistrationField = keyof RegistrationValues;

const requestErrorMessages = {
  emailAlreadyExists: 'Ya existe una cuenta con este email.',
  validation: 'No pudimos validar los datos. Revisá los campos e intentá nuevamente.',
  timeout: 'No pudimos confirmar si tu cuenta fue creada. Intentá nuevamente.',
  network: 'No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.',
  unexpected: 'No pudimos crear tu cuenta en este momento. Intentá nuevamente.',
} as const satisfies Record<RegisterErrorKind, string>;

type RegistrationRequestError = {
  message: string;
  showLoginLink?: boolean;
};

const indeterminateRegistrationMessage =
  'No pudimos confirmar si tu cuenta fue creada. Es posible que ya exista.';

const initialValues: RegistrationValues = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
};

function updateFieldError(
  currentErrors: RegistrationFieldErrors,
  field: RegistrationField,
  nextErrors: RegistrationFieldErrors,
): RegistrationFieldErrors {
  const next = { ...currentErrors };
  if (nextErrors[field]) {
    next[field] = nextErrors[field];
  } else {
    delete next[field];
  }
  return next;
}

export function RegistrationPage() {
  const navigate = useNavigate();
  const [values, setValues] = useState<RegistrationValues>(initialValues);
  const [errors, setErrors] = useState<RegistrationFieldErrors>({});
  const [visited, setVisited] = useState<Partial<Record<RegistrationField, boolean>>>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [requestError, setRequestError] = useState<RegistrationRequestError | null>(null);
  const [hasTimedOut, setHasTimedOut] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const submitInFlightRef = useRef(false);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isMountedRef = useRef(true);
  const registrationAbortControllerRef = useRef<AbortController>(undefined);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      registrationAbortControllerRef.current?.abort();
      registrationAbortControllerRef.current = undefined;
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    };
  }, []);

  function validateVisitedField(field: RegistrationField, nextValues: RegistrationValues) {
    const nextValidation = validateRegistrationFields(nextValues);
    setErrors((currentErrors) => {
      let nextErrors = updateFieldError(currentErrors, field, nextValidation);
      if (field === 'password' && (visited.confirmPassword || currentErrors.confirmPassword)) {
        nextErrors = updateFieldError(nextErrors, 'confirmPassword', nextValidation);
      }
      return nextErrors;
    });
  }

  function handleChange(field: RegistrationField, value: string) {
    const nextValues = { ...values, [field]: value };
    setValues(nextValues);
    setRequestError(null);
    setHasTimedOut(false);
    if (visited[field] || errors[field]) {
      validateVisitedField(field, nextValues);
    } else if (field === 'password' && (visited.confirmPassword || errors.confirmPassword)) {
      validateVisitedField(field, nextValues);
    }
  }

  function handleBlur(field: RegistrationField) {
    setVisited((currentVisited) => ({ ...currentVisited, [field]: true }));
    validateVisitedField(field, values);
  }

  function focusFirstInvalid(errorsToFocus: RegistrationFieldErrors) {
    if (errorsToFocus.fullName) nameRef.current?.focus();
    else if (errorsToFocus.email) emailRef.current?.focus();
    else if (errorsToFocus.password) passwordRef.current?.focus();
    else if (errorsToFocus.confirmPassword) confirmationRef.current?.focus();
  }

  function submitRegistration() {
    if (submitInFlightRef.current || isSuccess) return;

    const nextErrors = validateRegistrationFields(values);
    setHasSubmitted(true);
    setVisited({ fullName: true, email: true, password: true, confirmPassword: true });
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalid(nextErrors);
      return;
    }

    submitInFlightRef.current = true;
    setIsLoading(true);
    setRequestError(null);

    const credentials = { name: values.fullName, email: values.email, password: values.password };
    const abortController = new AbortController();
    registrationAbortControllerRef.current = abortController;

    void registerService
      .register(credentials, abortController.signal)
      .then(() => {
        if (!isMountedRef.current || abortController.signal.aborted) return;
        registrationAbortControllerRef.current = undefined;
        setValues((v) => ({ ...v, password: '', confirmPassword: '' }));
        setIsLoading(false);
        setIsSuccess(true);
        submitInFlightRef.current = false;
        successTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) navigate('/login', { replace: true });
        }, 250);
      })
      .catch((error: unknown) => {
        if (!isMountedRef.current || abortController.signal.aborted) return;
        registrationAbortControllerRef.current = undefined;
        const kind: RegisterErrorKind =
          error instanceof RegisterRequestError ? error.kind : 'unexpected';
        const isIndeterminateConflict = hasTimedOut && kind === 'emailAlreadyExists';
        const message = isIndeterminateConflict
          ? indeterminateRegistrationMessage
          : requestErrorMessages[kind];
        submitInFlightRef.current = false;
        setIsLoading(false);
        setRequestError({ message, showLoginLink: isIndeterminateConflict });
        setHasTimedOut((timedOut) => timedOut || kind === 'timeout');
        if (kind === 'emailAlreadyExists' && !isIndeterminateConflict) {
          setErrors((currentErrors) => ({ ...currentErrors, email: message }));
        }
      });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitRegistration();
  }

  const isBusy = isLoading || isSuccess;

  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center bg-brand-cream px-4 py-10">
      {/* Decorative ambient blob */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 h-72 w-72 -translate-y-1/3 translate-x-1/3 rounded-full bg-primary-container/20 blur-3xl"
      />

      {/* Card */}
      <div className="relative w-full max-w-md rounded-2xl border border-outline-variant/30 bg-surface-container-low p-8 shadow-[0_4px_20px_rgba(46,50,48,0.08)]">
        {/* Brand */}
        <div className="mb-6 flex justify-center">
          <BrandMark variant="auth" />
        </div>

        <header className="mb-8 text-center">
          <h1
            id="registration-title"
            className="font-headline text-3xl font-bold text-brand-green"
          >
            Creá tu cuenta
          </h1>
          <p className="mt-2 leading-relaxed text-on-surface-variant">
            Completá tus datos para empezar a cuidarte.
          </p>
        </header>

        <form
          className="space-y-5"
          noValidate
          aria-busy={isBusy || undefined}
          aria-labelledby="registration-title"
          onSubmit={handleSubmit}
        >
          {/* Global alerts */}
          {hasSubmitted && Object.keys(errors).length > 0 && !requestError && (
            <div
              className="rounded-lg border-l-4 border-error bg-error-container/30 p-3 text-sm text-on-error-container"
              role="alert"
            >
              {Object.values(errors).join(' ')}
            </div>
          )}
          {requestError && (
            <div
              className="rounded-lg border-l-4 border-error bg-error-container/30 p-3 text-sm text-on-error-container"
              role="alert"
            >
              <p>{requestError.message}</p>
              {requestError.showLoginLink && (
                <Link
                  className="mt-2 inline-block font-bold text-brand-green underline underline-offset-[0.18em] hover:text-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
                  to="/login"
                >
                  Ir al inicio de sesión
                </Link>
              )}
            </div>
          )}
          {isLoading && (
            <p aria-live="polite" className="sr-only">
              Creando cuenta...
            </p>
          )}
          {isSuccess && (
            <p
              className="rounded-lg border-l-4 border-brand-green bg-primary-fixed/30 p-3 text-sm text-brand-green-dark"
              role="status"
            >
              Cuenta creada. Ahora iniciá sesión.
            </p>
          )}

          {/* Full name */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-on-surface" htmlFor="full-name">
              Nombre
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-outline">
                <span aria-hidden="true" className="material-symbols-outlined text-xl">person</span>
              </div>
              <input
                ref={nameRef}
                className="w-full rounded-lg border border-outline-variant/50 bg-white py-3 pl-12 pr-4 text-on-surface shadow-sm transition-all placeholder:text-on-surface-variant/50 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/20 aria-invalid:border-error disabled:opacity-60"
                id="full-name"
                name="fullName"
                type="text"
                autoComplete="name"
                placeholder="Tu nombre"
                required
                disabled={isBusy}
                value={values.fullName}
                aria-invalid={errors.fullName ? 'true' : undefined}
                aria-describedby={errors.fullName ? 'full-name-error' : undefined}
                onBlur={() => handleBlur('fullName')}
                onChange={(event) => handleChange('fullName', event.target.value)}
              />
            </div>
            {errors.fullName && (
              <p className="text-sm text-error" id="full-name-error">
                {errors.fullName}
              </p>
            )}
          </div>

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
                inputMode="email"
                autoComplete="username"
                placeholder="tu@correo.com"
                required
                disabled={isBusy}
                value={values.email}
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={errors.email ? 'email-error' : undefined}
                onBlur={() => handleBlur('email')}
                onChange={(event) => handleChange('email', event.target.value)}
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
            <label className="block text-sm font-semibold text-on-surface" htmlFor="new-password">
              Contraseña
            </label>
            <p className="text-xs text-on-surface-variant" id="password-help">
              Al menos {MINIMUM_PASSWORD_LENGTH} caracteres.
            </p>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-outline">
                <span aria-hidden="true" className="material-symbols-outlined text-xl">lock</span>
              </div>
              <input
                ref={passwordRef}
                className="w-full rounded-lg border border-outline-variant/50 bg-white py-3 pl-12 pr-14 text-on-surface shadow-sm transition-all focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/20 aria-invalid:border-error disabled:opacity-60"
                id="new-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="••••••••"
                minLength={MINIMUM_PASSWORD_LENGTH}
                required
                disabled={isBusy}
                value={values.password}
                aria-invalid={errors.password ? 'true' : undefined}
                aria-describedby={errors.password ? 'password-help password-error' : 'password-help'}
                onBlur={() => handleBlur('password')}
                onChange={(event) => handleChange('password', event.target.value)}
              />
              <button
                className="absolute inset-y-0 right-0 flex min-h-12 items-center px-4 text-outline transition-colors hover:text-brand-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
                type="button"
                disabled={isBusy}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
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

          {/* Confirm password */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-on-surface" htmlFor="confirm-password">
              Confirmá tu contraseña
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-outline">
                <span aria-hidden="true" className="material-symbols-outlined text-xl">lock_reset</span>
              </div>
              <input
                ref={confirmationRef}
                className="w-full rounded-lg border border-outline-variant/50 bg-white py-3 pl-12 pr-14 text-on-surface shadow-sm transition-all focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/20 aria-invalid:border-error disabled:opacity-60"
                id="confirm-password"
                name="confirmPassword"
                type={showConfirmation ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="••••••••"
                enterKeyHint="done"
                required
                disabled={isBusy}
                value={values.confirmPassword}
                aria-invalid={errors.confirmPassword ? 'true' : undefined}
                aria-describedby={errors.confirmPassword ? 'confirm-password-error' : undefined}
                onBlur={() => handleBlur('confirmPassword')}
                onChange={(event) => handleChange('confirmPassword', event.target.value)}
              />
              <button
                className="absolute inset-y-0 right-0 flex min-h-12 items-center px-4 text-outline transition-colors hover:text-brand-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
                type="button"
                disabled={isBusy}
                aria-label={showConfirmation ? 'Ocultar confirmación de contraseña' : 'Mostrar confirmación de contraseña'}
                aria-pressed={showConfirmation}
                onClick={() => setShowConfirmation((v) => !v)}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-xl">
                  {showConfirmation ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="text-sm text-error" id="confirm-password-error">
                {errors.confirmPassword}
              </p>
            )}
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
            {!isLoading && (
              <span className="material-symbols-outlined text-xl" aria-hidden="true">
                person_add
              </span>
            )}
            {isLoading ? 'Creando cuenta...' : 'Crear cuenta'}
          </button>

          {/* Retry on request error */}
          {requestError && (
            <button
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand-green/30 py-3 font-bold text-brand-green transition-all hover:bg-primary-fixed/20 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
              type="button"
              onClick={submitRegistration}
            >
              <span className="material-symbols-outlined text-xl">refresh</span>
              Reintentar
            </button>
          )}
        </form>

        {/* Footer */}
        <p className="mt-8 text-center text-sm text-on-surface-variant">
          ¿Ya tenés cuenta?{' '}
          <Link
            className="font-bold text-brand-green underline-offset-4 transition-colors hover:text-tertiary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
            to="/login"
          >
            Iniciá sesión
          </Link>
        </p>
      </div>
    </main>
  );
}
