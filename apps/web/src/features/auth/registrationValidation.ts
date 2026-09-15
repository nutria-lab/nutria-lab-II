export const MINIMUM_PASSWORD_LENGTH = 6;

export type RegistrationValues = {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export type RegistrationFieldErrors = Partial<
  Record<keyof RegistrationValues, string>
>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRegistrationFields({
  fullName,
  email,
  password,
  confirmPassword,
}: RegistrationValues): RegistrationFieldErrors {
  const errors: RegistrationFieldErrors = {};

  if (!fullName.trim()) {
    errors.fullName = "Ingresá tu nombre.";
  }

  if (!email.trim()) {
    errors.email = "Ingresá tu correo electrónico.";
  } else if (!emailPattern.test(email.trim())) {
    errors.email = "Ingresá un correo electrónico válido.";
  }

  if (!password) {
    errors.password = "Ingresá tu contraseña.";
  } else if (password.length < MINIMUM_PASSWORD_LENGTH) {
    errors.password = `La contraseña debe tener al menos ${MINIMUM_PASSWORD_LENGTH} caracteres.`;
  }

  if (!confirmPassword) {
    errors.confirmPassword = "Confirmá tu contraseña.";
  } else if (confirmPassword !== password) {
    errors.confirmPassword = "Las contraseñas no coinciden.";
  }

  return errors;
}
