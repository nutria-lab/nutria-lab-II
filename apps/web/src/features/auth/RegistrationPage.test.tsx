import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RegistrationPage } from './RegistrationPage';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderRegistration() {
  return render(
    <MemoryRouter>
      <RegistrationPage />
    </MemoryRouter>,
  );
}

function getForm() {
  return document.querySelector('form')!;
}

async function fillValidRegistration(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^nombre$/i), 'María Ñu');
  await user.type(screen.getByLabelText(/correo electrónico/i), 'maria@nutria.com');
  await user.type(screen.getByLabelText(/^contraseña$/i), 'secreta');
  await user.type(screen.getByLabelText(/confirmá tu contraseña/i), 'secreta');
}

describe('RegistrationPage', () => {
  it('renders the local, semantic sign-up form with its navigation to login', () => {
    renderRegistration();

    expect(screen.getByText('NutrIA')).toBeVisible();
    const brandIcon = document.querySelector('img');
    expect(brandIcon).toHaveAttribute('src', expect.stringContaining('nutria-icon.png'));
    expect(brandIcon).toHaveAttribute('alt', '');
    expect(brandIcon).toHaveAttribute('aria-hidden', 'true');
    expect(brandIcon?.parentElement).toHaveClass('justify-between');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    expect(screen.getByRole('heading', { name: /creá tu cuenta/i })).toBeVisible();
    expect(screen.getByText(/todavía no se creará una cuenta/i)).toBeVisible();
    expect(getForm()).toHaveAttribute('novalidate');

    const name = screen.getByLabelText(/^nombre$/i);
    expect(name).toHaveAttribute('id', 'full-name');
    expect(name).toHaveAttribute('name', 'fullName');
    expect(name).toHaveAttribute('type', 'text');
    expect(name).toHaveAttribute('autocomplete', 'name');
    expect(name).toBeRequired();

    const email = screen.getByLabelText(/correo electrónico/i);
    expect(email).toHaveAttribute('id', 'email');
    expect(email).toHaveAttribute('name', 'email');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('inputmode', 'email');
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(email).toBeRequired();

    const password = screen.getByLabelText(/^contraseña$/i);
    expect(password).toHaveAttribute('id', 'new-password');
    expect(password).toHaveAttribute('name', 'password');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(password).toHaveAttribute('minlength', '6');
    expect(password).toBeRequired();
    expect(password).toHaveAccessibleDescription(/al menos 6 caracteres/i);

    const confirmPassword = screen.getByLabelText(/confirmá tu contraseña/i);
    expect(confirmPassword).toHaveAttribute('id', 'confirm-password');
    expect(confirmPassword).toHaveAttribute('name', 'confirmPassword');
    expect(confirmPassword).toHaveAttribute('type', 'password');
    expect(confirmPassword).toHaveAttribute('autocomplete', 'new-password');
    expect(confirmPassword).toHaveAttribute('enterkeyhint', 'done');
    expect(confirmPassword).toBeRequired();

    expect(screen.getByRole('button', { name: /crear cuenta/i })).toBeEnabled();
    expect(screen.getByRole('link', { name: /iniciá sesión/i })).toHaveAttribute('href', '/login');
  });

  it('shows field-local validation after blur and focuses the first invalid field after submit', async () => {
    const user = userEvent.setup();
    renderRegistration();

    const email = screen.getByLabelText(/correo electrónico/i);
    await user.type(email, 'correo-invalido');
    await user.tab();

    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription(/correo electrónico válido/i);
    expect(screen.getByText(/correo electrónico válido/i).closest('div')).toContainElement(email);

    fireEvent.submit(getForm());

    expect(screen.getByRole('alert')).toHaveTextContent(/ingresá tu nombre/i);
    expect(screen.getByLabelText(/^nombre$/i)).toHaveFocus();
    expect(screen.getByLabelText(/^nombre$/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^contraseña$/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/confirmá tu contraseña/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('validates the password minimum and a confirmation mismatch, then updates feedback while editing', async () => {
    const user = userEvent.setup();
    renderRegistration();

    const password = screen.getByLabelText(/^contraseña$/i);
    const confirmPassword = screen.getByLabelText(/confirmá tu contraseña/i);
    await user.type(password, 'corta');
    await user.tab();
    expect(password).toHaveAccessibleDescription(/al menos 6 caracteres/i);
    expect(password).toHaveAttribute('aria-invalid', 'true');

    await user.clear(password);
    await user.type(password, 'secreta');
    expect(password).not.toHaveAttribute('aria-invalid');

    await user.type(confirmPassword, 'distinta');
    await user.tab();
    expect(confirmPassword).toHaveAttribute('aria-invalid', 'true');
    expect(confirmPassword).toHaveAccessibleDescription(/no coinciden/i);

    await user.clear(confirmPassword);
    await user.type(confirmPassword, 'secreta');
    expect(confirmPassword).not.toHaveAttribute('aria-invalid');

    await user.type(password, 'x');
    expect(confirmPassword).toHaveAttribute('aria-invalid', 'true');
    expect(confirmPassword).toHaveAccessibleDescription(/no coinciden/i);
  });

  it('toggles each password independently without losing its value or blocking paste', async () => {
    const user = userEvent.setup();
    renderRegistration();

    const password = screen.getByLabelText(/^contraseña$/i);
    const confirmPassword = screen.getByLabelText(/confirmá tu contraseña/i);
    await user.type(password, 'secreta');
    await user.type(confirmPassword, 'otra-clave');

    const paste = new Event('paste', { bubbles: true, cancelable: true });
    password.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(false);

    await user.click(screen.getByRole('button', { name: /mostrar contraseña$/i }));
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('secreta');
    expect(confirmPassword).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: /ocultar contraseña$/i })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: /mostrar confirmación de contraseña/i }));
    expect(confirmPassword).toHaveAttribute('type', 'text');
    expect(confirmPassword).toHaveValue('otra-clave');
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /ocultar confirmación de contraseña/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('gives both password visibility controls 48 px touch targets', () => {
    renderRegistration();

    expect(screen.getByRole('button', { name: /mostrar contraseña$/i })).toHaveClass('min-h-12');
    expect(screen.getByRole('button', { name: /mostrar confirmación de contraseña/i })).toHaveClass('min-h-12');
  });

  it('locks every field and password visibility control during local loading', async () => {
    const user = userEvent.setup();
    renderRegistration();

    await fillValidRegistration(user);
    vi.useFakeTimers();
    fireEvent.submit(getForm());

    expect(screen.getByLabelText(/^nombre$/i)).toBeDisabled();
    expect(screen.getByLabelText(/correo electrónico/i)).toBeDisabled();
    expect(screen.getByLabelText(/^contraseña$/i)).toBeDisabled();
    expect(screen.getByLabelText(/confirmá tu contraseña/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /mostrar contraseña$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /mostrar confirmación de contraseña/i })).toBeDisabled();
    expect(screen.getByRole('link', { name: /iniciá sesión/i })).toBeEnabled();
  });

  it('uses only local state for a valid submission and exposes loading before local success', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storageSetItem = vi.spyOn(Storage.prototype, 'setItem');
    vi.stubGlobal('fetch', fetchMock);
    renderRegistration();

    await fillValidRegistration(user);
    vi.useFakeTimers();
    fireEvent.submit(getForm());

    expect(getForm()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: /creando cuenta/i })).toBeDisabled();
    expect(screen.getByLabelText(/^contraseña$/i)).toHaveValue('secreta');
    fireEvent.submit(getForm());
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByRole('status')).toHaveTextContent(/todavía no fue creada|sin conexión con la api/i);
    expect(screen.getByLabelText(/^contraseña$/i)).toHaveValue('');
    expect(screen.getByLabelText(/confirmá tu contraseña/i)).toHaveValue('');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(storageSetItem).not.toHaveBeenCalled();
  });

  it('keeps the login link keyboard-operable after local success', async () => {
    const user = userEvent.setup();
    renderRegistration();

    await fillValidRegistration(user);
    vi.useFakeTimers();
    fireEvent.submit(getForm());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    const login = screen.getByRole('link', { name: /iniciá sesión/i });
    expect(screen.getByRole('status')).toBeVisible();
    login.focus();
    expect(login).toHaveFocus();
    expect(login).toHaveAttribute('href', '/login');
  });
});
