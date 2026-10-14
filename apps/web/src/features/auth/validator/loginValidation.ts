export type LoginFieldErrors = {
  email?: string;
  password?: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLoginFields(email: string, password: string): LoginFieldErrors {
  const errors: LoginFieldErrors = {};

  if (!email.trim()) {
    errors.email = 'Ingresá tu correo electrónico.';
  } else if (!emailPattern.test(email.trim())) {
    errors.email = 'Ingresá un correo electrónico válido.';
  }

  if (!password) {
    errors.password = 'Ingresá tu contraseña.';
  }

  return errors;
}
