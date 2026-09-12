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

const indeterminateRegistrationMessage = 'No pudimos confirmar si tu cuenta fue creada. Es posible que ya exista.';

const initialValues: RegistrationValues = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
};

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

      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
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
    if (errorsToFocus.fullName) {
      nameRef.current?.focus();
    } else if (errorsToFocus.email) {
      emailRef.current?.focus();
    } else if (errorsToFocus.password) {
      passwordRef.current?.focus();
    } else if (errorsToFocus.confirmPassword) {
      confirmationRef.current?.focus();
    }
  }

  function submitRegistration() {
    if (submitInFlightRef.current || isSuccess) {
      return;
    }

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

    const credentials = {
      name: values.fullName,
      email: values.email,
      password: values.password,
    };
    const abortController = new AbortController();
    registrationAbortControllerRef.current = abortController;

    void registerService.register(credentials, abortController.signal)
      .then(() => {
        if (!isMountedRef.current || abortController.signal.aborted) {
          return;
        }

        registrationAbortControllerRef.current = undefined;
        setValues((currentValues) => ({ ...currentValues, password: '', confirmPassword: '' }));
        setIsLoading(false);
        setIsSuccess(true);
        submitInFlightRef.current = false;
        successTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            navigate('/login', { replace: true });
          }
        }, 250);
      })
      .catch((error: unknown) => {
        if (!isMountedRef.current || abortController.signal.aborted) {
          return;
        }

        registrationAbortControllerRef.current = undefined;
        const kind: RegisterErrorKind = error instanceof RegisterRequestError ? error.kind : 'unexpected';
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

  const inputClassName = 'min-h-12 w-full rounded-lg border border-[#b7b7a8] bg-[#fffefa] px-3 py-2.5 text-base aria-invalid:border-[#9e2f27] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#c88b35]';

  return (
    <main className="min-h-dvh w-full bg-[#f7f1e5] md:grid md:grid-cols-2">
      <aside className="hidden min-h-dvh items-center justify-center bg-[#b58c43] p-12 text-[#fffdf8] md:flex" aria-hidden="true">
        <div className="flex max-w-sm flex-col items-center text-center">
          <OutlineLeaf />
          <p className="mt-8 font-serif text-xl leading-7">Tu bienestar empieza con pequeños pasos.</p>
        </div>
      </aside>

      <section
        aria-labelledby="registration-title"
        className="grid min-h-dvh w-full place-items-center bg-[#f7f1e5] px-6 py-10 md:px-[clamp(2.5rem,7vw,7rem)] md:py-12"
      >
        <div className="w-full max-w-[25rem] md:max-w-[23rem]">
          <BrandMark variant="auth" />

          <header className="mb-7 text-center">
            <h1 id="registration-title" className="m-0 font-serif text-[clamp(2rem,8vw,2.35rem)] font-semibold leading-[1.15] tracking-[-0.025em] text-[#254a36] md:text-4xl">
              Creá tu cuenta
            </h1>
            <p className="mt-2.5 leading-6 text-[#5f675c]">Completá tus datos para empezar a cuidarte.</p>
          </header>

          <form className="grid gap-[1.1rem]" noValidate aria-busy={isLoading || undefined} onSubmit={handleSubmit}>
            {hasSubmitted && Object.keys(errors).length > 0 && !requestError && (
              <div className="rounded-lg border-l-4 border-[#9e2f27] bg-[#fff1ee] p-3 text-[#6d211c]" role="alert">
                {Object.values(errors).join(' ')}
              </div>
            )}
            {requestError && (
              <div className="rounded-lg border-l-4 border-[#9e2f27] bg-[#fff1ee] p-3 text-[#6d211c]" role="alert">
                <p className="m-0">{requestError.message}</p>
                {requestError.showLoginLink && (
                  <Link className="mt-2 inline-block font-bold text-[#254a36] underline underline-offset-[0.18em] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#c88b35]" to="/login">
                    Ir al inicio de sesión
                  </Link>
                )}
              </div>
            )}
            {isLoading && <p aria-live="polite" className="sr-only">Creando cuenta...</p>}
            {isSuccess && (
              <p className="m-0 rounded-lg border-l-4 border-[#254a36] bg-[#edf5e9] p-3 text-[#254a36]" role="status">
                Cuenta creada. Ahora iniciá sesión.
              </p>
            )}

            <div className="grid gap-2">
              <label className="text-sm font-bold" htmlFor="full-name">Nombre</label>
              <input
                ref={nameRef}
                className={inputClassName}
                id="full-name"
                name="fullName"
                type="text"
                autoComplete="name"
                required
                disabled={isLoading || isSuccess}
                value={values.fullName}
                aria-invalid={errors.fullName ? 'true' : undefined}
                aria-describedby={errors.fullName ? 'full-name-error' : undefined}
                onBlur={() => handleBlur('fullName')}
                onChange={(event) => handleChange('fullName', event.target.value)}
              />
              {errors.fullName && <p className="m-0 text-[#9e2f27]" id="full-name-error">{errors.fullName}</p>}
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-bold" htmlFor="email">Correo electrónico</label>
              <input
                ref={emailRef}
                className={inputClassName}
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                required
                disabled={isLoading || isSuccess}
                value={values.email}
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={errors.email ? 'email-error' : undefined}
                onBlur={() => handleBlur('email')}
                onChange={(event) => handleChange('email', event.target.value)}
              />
              {errors.email && <p className="m-0 text-[#9e2f27]" id="email-error">{errors.email}</p>}
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-bold" htmlFor="new-password">Contraseña</label>
              <p className="m-0 text-sm leading-5 text-[#5f675c]" id="password-help">Al menos {MINIMUM_PASSWORD_LENGTH} caracteres.</p>
              <div className="relative">
                <input
                  ref={passwordRef}
                  className={`${inputClassName} pr-[5.5rem]`}
                  id="new-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={MINIMUM_PASSWORD_LENGTH}
                  required
                  disabled={isLoading || isSuccess}
                  value={values.password}
                  aria-invalid={errors.password ? 'true' : undefined}
                  aria-describedby={errors.password ? 'password-help password-error' : 'password-help'}
                  onBlur={() => handleBlur('password')}
                  onChange={(event) => handleChange('password', event.target.value)}
                />
                <button
                  className="absolute top-0.5 right-0.5 min-h-12 rounded-md border-0 bg-transparent px-3 py-2 text-sm font-bold text-[#254a36] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#c88b35]"
                  type="button"
                  disabled={isLoading || isSuccess}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              {errors.password && <p className="m-0 text-[#9e2f27]" id="password-error">{errors.password}</p>}
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-bold" htmlFor="confirm-password">Confirmá tu contraseña</label>
              <div className="relative">
                <input
                  ref={confirmationRef}
                  className={`${inputClassName} pr-[7.5rem]`}
                  id="confirm-password"
                  name="confirmPassword"
                  type={showConfirmation ? 'text' : 'password'}
                  autoComplete="new-password"
                  enterKeyHint="done"
                  required
                  disabled={isLoading || isSuccess}
                  value={values.confirmPassword}
                  aria-invalid={errors.confirmPassword ? 'true' : undefined}
                  aria-describedby={errors.confirmPassword ? 'confirm-password-error' : undefined}
                  onBlur={() => handleBlur('confirmPassword')}
                  onChange={(event) => handleChange('confirmPassword', event.target.value)}
                />
                <button
                  className="absolute top-0.5 right-0.5 min-h-12 rounded-md border-0 bg-transparent px-3 py-2 text-sm font-bold text-[#254a36] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#c88b35]"
                  type="button"
                  disabled={isLoading || isSuccess}
                  aria-label={showConfirmation ? 'Ocultar confirmación de contraseña' : 'Mostrar confirmación de contraseña'}
                  aria-pressed={showConfirmation}
                  onClick={() => setShowConfirmation((visible) => !visible)}
                >
                  {showConfirmation ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              {errors.confirmPassword && <p className="m-0 text-[#9e2f27]" id="confirm-password-error">{errors.confirmPassword}</p>}
            </div>

            <button
              className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-[#254a36] px-4 py-3 font-extrabold text-[#fffdf8] disabled:cursor-wait disabled:bg-[#345b45] disabled:opacity-100 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#c88b35]"
              disabled={isLoading || isSuccess}
              type="submit"
            >
              {isLoading && <span aria-hidden="true" className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />}
              {isLoading ? 'Creando cuenta...' : 'Crear cuenta'}
            </button>
            {requestError && (
              <button
                className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-lg border border-[#254a36] bg-transparent px-4 py-3 font-extrabold text-[#254a36] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#c88b35]"
                type="button"
                onClick={submitRegistration}
              >
                Reintentar
              </button>
            )}
          </form>

          <p className="mx-auto mt-7 text-center text-sm text-[#5f675c]">
            ¿Ya tenés cuenta? <Link className="font-bold text-[#254a36] underline underline-offset-[0.18em] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#c88b35]" to="/login">Iniciá sesión</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
