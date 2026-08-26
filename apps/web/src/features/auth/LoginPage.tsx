import { type FormEvent, useRef, useState } from 'react';

import { validateLoginFields, type LoginFieldErrors } from './loginValidation';
import nutriaIcon from '../../assets/nutria-icon.png';
import './login.css';

function OutlineLeaf() {
  return (
    <svg aria-hidden="true" className="login-outline-leaf" viewBox="0 0 128 128">
      <path d="M99 15C84 34 66 40 47 48 25 57 15 75 25 101c9-22 26-38 49-47 17-7 26-20 25-39Z" />
      <path d="M25 101c16-23 34-39 74-86" />
    </svg>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<LoginFieldErrors>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateLoginFields(email, password);
    setErrors(nextErrors);

    if (nextErrors.email) {
      emailRef.current?.focus();
    } else if (nextErrors.password) {
      passwordRef.current?.focus();
    }
  }

  function handleEmailChange(nextEmail: string) {
    setEmail(nextEmail);

    if (errors.email) {
      setErrors((currentErrors) => {
        const { email: _emailError, ...remainingErrors } = currentErrors;
        return remainingErrors;
      });
    }
  }

  return (
    <main className="login-page">
      <aside className="login-visual-panel" aria-hidden="true">
        <div className="login-visual-content">
          <OutlineLeaf />
          <p>Nutrirte bien empieza con elegir con intención.</p>
        </div>
      </aside>

      <section className="login-card" aria-labelledby="login-title">
        <div className="login-content">
          <div className="login-brand">
            <img alt="Hoja de NutrIA" className="login-brand-icon" src={nutriaIcon} />
          </div>

          <header className="login-header">
            <h1 id="login-title">Iniciá sesión</h1>
            <p>Ingresá tus datos para continuar</p>
          </header>

          <form className="login-form" noValidate onSubmit={handleSubmit}>
            {Object.keys(errors).length > 0 && (
              <div className="login-error-summary" role="alert">
                {Object.values(errors).join(' ')}
              </div>
            )}
            <div className="login-field">
              <label htmlFor="email">Correo electrónico</label>
              <input
                ref={emailRef}
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={errors.email ? 'email-error' : undefined}
                onChange={(event) => handleEmailChange(event.target.value)}
              />
              {errors.email && <p className="login-field-error" id="email-error">{errors.email}</p>}
            </div>

            <div className="login-field">
              <label htmlFor="current-password">Contraseña</label>
              <div className="login-password-control">
                <input
                  ref={passwordRef}
                  id="current-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  aria-invalid={errors.password ? 'true' : undefined}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  className="login-password-toggle"
                  type="button"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              {errors.password && <p className="login-field-error" id="password-error">{errors.password}</p>}
            </div>

            <div className="login-options">
              <label className="login-remember" htmlFor="remember-me">
                <input id="remember-me" name="rememberMe" type="checkbox" />
                <span>Recordarme</span>
              </label>
              <button className="login-forgot-password" type="button">¿Olvidaste tu contraseña?</button>
            </div>

            <button className="login-submit" type="submit">Iniciá sesión</button>
          </form>

          <p className="login-register">
            ¿No tenés cuenta? <span className="login-register-link">Registrate</span>
          </p>
        </div>
      </section>
    </main>
  );
}
