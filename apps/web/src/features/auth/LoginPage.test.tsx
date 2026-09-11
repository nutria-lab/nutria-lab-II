import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoginPage } from './LoginPage';

afterEach(cleanup);

function renderLogin(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('LoginPage', () => {
  it('renders the approved Spanish login form with native sign-in semantics', () => {
    renderLogin(<LoginPage />);

    expect(screen.getByRole('heading', { name: /iniciá sesión/i })).toBeVisible();
    expect(screen.getByText('Ingresá tus datos para continuar')).toBeVisible();
    expect(screen.getByText('NutrIA')).toBeVisible();
    const brandIcon = document.querySelector('img');
    expect(brandIcon).toHaveAttribute('src', expect.stringContaining('nutria-icon.png'));
    expect(brandIcon).toHaveAttribute('alt', '');
    expect(brandIcon).toHaveAttribute('aria-hidden', 'true');
    expect(brandIcon?.parentElement).toHaveClass('justify-between');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' })).toBeVisible();
    const register = screen.getByRole('link', { name: 'Registrate' });
    expect(register).toBeVisible();
    expect(register).toHaveAttribute('href', '/register');
    expect(register.parentElement).toHaveTextContent('¿No tenés cuenta? Registrate');
    expect(screen.queryByText('Tu bienestar, a tu ritmo')).not.toBeInTheDocument();
    expect(document.querySelector('form')).toBeInTheDocument();

    const email = screen.getByLabelText(/correo/i);
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(email).toBeRequired();

    const password = screen.getByLabelText(/^contraseña$/i);
    expect(password).toHaveAttribute('id', 'current-password');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(password).toBeRequired();

    expect(screen.getByRole('checkbox', { name: /recordarme/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /iniciá sesión|continuar/i })).toBeVisible();
  });

  it('lets a person show or hide their password without changing it or blocking paste', async () => {
    const user = userEvent.setup();
    renderLogin(<LoginPage />);

    const password = screen.getByLabelText(/^contraseña$/i);
    await user.type(password, 'secreta');

    const paste = new Event('paste', { bubbles: true, cancelable: true });
    password.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(false);

    await user.click(screen.getByRole('button', { name: /mostrar contraseña/i }));
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('secreta');
    expect(screen.getByRole('button', { name: /ocultar contraseña/i })).toBeVisible();

    await user.click(screen.getByRole('button', { name: /ocultar contraseña/i }));
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('secreta');
  });

  it('keeps an invalid email local and communicates accessible feedback', async () => {
    const user = userEvent.setup();
    renderLogin(<LoginPage />);

    const email = screen.getByLabelText(/correo/i);
    await user.type(email, 'correo-invalido');
    fireEvent.submit(document.querySelector('form')!);

    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(/correo.*válido|formato/i);
  });

  it('keeps password recovery presentation-only without changing the URL', async () => {
    const user = userEvent.setup();
    renderLogin(<LoginPage />);

    const initialUrl = window.location.href;
    await user.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }));

    expect(window.location.href).toBe(initialUrl);
  });

  it('exposes Registrate as the styleable semantic link to registration', () => {
    renderLogin(<LoginPage />);

    const register = screen.getByRole('link', { name: 'Registrate' });
    expect(register.previousSibling?.textContent).toBe('¿No tenés cuenta? ');
    expect(register.parentElement).toHaveTextContent('¿No tenés cuenta? Registrate');
    expect(register.parentElement?.childElementCount).toBe(1);
    expect(register).toHaveAttribute('href', '/register');
  });

  it('keeps desktop branding separate from the labelled login region', () => {
    renderLogin(<LoginPage />);

    expect(screen.getByText('Nutrirte bien empieza con elegir con intención.').closest('aside')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('form')?.closest('section')).toHaveAttribute('aria-labelledby', 'login-title');
  });

  it('clears local email feedback while the person corrects the address', async () => {
    const user = userEvent.setup();
    renderLogin(<LoginPage />);

    const email = screen.getByLabelText(/correo/i);
    await user.type(email, 'correo-invalido');
    await user.type(screen.getByLabelText(/^contraseña$/i), 'secreta');
    fireEvent.submit(document.querySelector('form')!);

    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(/correo.*válido|formato/i);

    await user.clear(email);
    await user.type(email, 'persona@nutria.com');

    expect(email).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears local password-required feedback while the person corrects the password', async () => {
    const user = userEvent.setup();
    renderLogin(<LoginPage />);

    const email = screen.getByLabelText(/correo/i);
    const password = screen.getByLabelText(/^contraseña$/i);
    await user.type(email, 'persona@nutria.com');
    fireEvent.submit(document.querySelector('form')!);

    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Ingresá tu contraseña.');

    await user.type(password, 'secreta');

    expect(password).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders invalid credentials as a non-enumerating presentation state without replacing field semantics', () => {
    renderLogin(<LoginPage status="invalidCredentials" />);

    expect(screen.getByRole('alert')).toHaveTextContent('El correo o la contraseña no son correctos.');
    expect(screen.getByLabelText(/correo/i)).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^contraseña$/i)).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('checkbox', { name: /recordarme/i })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Iniciá sesión' })).toBeEnabled();
  });

  it('renders loading as an accessible presentation state that prevents repeated submission', () => {
    renderLogin(<LoginPage status="loading" />);

    const form = document.querySelector('form')!;
    const submit = screen.getByRole('button', { name: 'Iniciando sesión...' });

    expect(form).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: /iniciando sesión/i })).toBeVisible();
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText(/correo/i)).toBeVisible();
    expect(screen.getByLabelText(/^contraseña$/i)).toBeVisible();
  });

  it('delegates one locally valid submit with only the email and password', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderLogin(<LoginPage onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/correo/i), 'persona@nutria.com');
    await user.type(screen.getByLabelText(/^contraseña$/i), 'secreta');
    await user.click(screen.getByRole('button', { name: 'Iniciá sesión' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ email: 'persona@nutria.com', password: 'secreta' });
  });

  it('does not delegate invalid local values or a submit while loading', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = renderLogin(<LoginPage onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Iniciá sesión' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Ingresá tu correo electrónico. Ingresá tu contraseña.');

    rerender(<MemoryRouter><LoginPage status="loading" onSubmit={onSubmit} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Iniciando sesión...' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
