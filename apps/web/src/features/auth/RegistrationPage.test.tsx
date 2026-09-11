import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../../services/apiClient';
import { RegistrationPage } from './RegistrationPage';

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

const registeredUser = {
  id: 'user-9',
  email: 'maria@nutria.com',
  name: 'María Ñu',
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z',
};

const requestConfig = {
  headers: {},
} as InternalAxiosRequestConfig;

function httpFailure(status: number) {
  return new AxiosError(
    `Request failed with status ${status}`,
    AxiosError.ERR_BAD_RESPONSE,
    requestConfig,
    undefined,
    {
      data: { message: 'internal backend detail' },
      status,
      statusText: 'Error',
      headers: {},
      config: requestConfig,
    },
  );
}

function networkFailure() {
  return new AxiosError('Network Error', AxiosError.ERR_NETWORK, requestConfig);
}

function timeoutFailure() {
  return new AxiosError('timeout', 'ECONNABORTED', requestConfig);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
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

    expect(screen.getByRole('heading', { name: /creá tu cuenta/i })).toBeVisible();
    expect(screen.queryByText(/todavía no se creará una cuenta/i)).not.toBeInTheDocument();
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
    expect(apiClient.post).not.toHaveBeenCalled();
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

  it('submits a valid DTO once through the shared client, locks the form, clears secrets, and announces success', async () => {
    const user = userEvent.setup();
    let resolveRegistration!: (value: unknown) => void;
    const pendingRegistration = new Promise((resolve) => {
      resolveRegistration = resolve;
    });
    vi.mocked(apiClient.post).mockReturnValue(pendingRegistration as never);
    renderRegistration();

    await fillValidRegistration(user);
    fireEvent.submit(getForm());

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith(
      '/auth/register',
      {
        name: 'María Ñu',
        email: 'maria@nutria.com',
        password: 'secreta',
      },
      expect.objectContaining({ skipAuthErrorHandling: true }),
    );
    expect(vi.mocked(apiClient.post).mock.calls[0]?.[1]).not.toHaveProperty('confirmPassword');
    expect(getForm()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText(/^nombre$/i)).toBeDisabled();
    expect(screen.getByLabelText(/correo electrónico/i)).toBeDisabled();
    expect(screen.getByLabelText(/^contraseña$/i)).toBeDisabled();
    expect(screen.getByLabelText(/confirmá tu contraseña/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /mostrar contraseña$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /mostrar confirmación de contraseña/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /creando cuenta/i })).toBeDisabled();

    resolveRegistration({ data: registeredUser });
    expect(await screen.findByRole('status')).toHaveTextContent('Cuenta creada. Ahora iniciá sesión.');
    expect(screen.getByLabelText(/^contraseña$/i)).toHaveValue('');
    expect(screen.getByLabelText(/confirmá tu contraseña/i)).toHaveValue('');
  });

  it('normalizes an existing email and backend validation without navigating or exposing raw backend details', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockRejectedValueOnce(httpFailure(409));
    renderRegistration();

    await fillValidRegistration(user);
    fireEvent.submit(getForm());

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe una cuenta con este email.');
    expect(screen.getByLabelText(/correo electrónico/i)).toHaveAccessibleDescription('Ya existe una cuenta con este email.');
    expect(screen.queryByText(/internal backend detail/i)).not.toBeInTheDocument();

    cleanup();
    vi.clearAllMocks();
    vi.mocked(apiClient.post).mockRejectedValueOnce(httpFailure(400));
    renderRegistration();

    await fillValidRegistration(user);
    fireEvent.submit(getForm());

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos validar los datos. Revisá los campos e intentá nuevamente.');
    expect(screen.queryByText(/internal backend detail/i)).not.toBeInTheDocument();
  });

  it('distinguishes a network failure from an unexpected failure and retries only after activation', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post)
      .mockRejectedValueOnce(networkFailure())
      .mockResolvedValueOnce({ data: registeredUser } as never);
    renderRegistration();

    await fillValidRegistration(user);
    fireEvent.submit(getForm());

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.');
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    const retry = screen.getByRole('button', { name: /reintentar/i });
    expect(retry).toBeEnabled();

    await user.click(retry);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('status')).toHaveTextContent('Cuenta creada. Ahora iniciá sesión.');

    cleanup();
    vi.clearAllMocks();
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('unexpected'));
    renderRegistration();

    await fillValidRegistration(user);
    fireEvent.submit(getForm());

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos crear tu cuenta en este momento. Intentá nuevamente.');
  });

  it('treats a 409 after a timeout as indeterminate and guides the person to login instead of claiming the email exists', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post)
      .mockRejectedValueOnce(timeoutFailure())
      .mockRejectedValueOnce(httpFailure(409));
    renderRegistration();

    await fillValidRegistration(user);
    fireEvent.submit(getForm());

    await user.click(await screen.findByRole('button', { name: /reintentar/i }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/no pudimos confirmar si tu cuenta fue creada/i);
    expect(alert).not.toHaveTextContent('Ya existe una cuenta con este email.');
    expect(screen.getByRole('link', { name: /iniciá sesión/i })).toHaveAttribute('href', '/login');
  });

  it('blocks repeated submit events while a registration request is pending', async () => {
    const user = userEvent.setup();
    let resolveRegistration!: (value: unknown) => void;
    const pendingRegistration = new Promise((resolve) => {
      resolveRegistration = resolve;
    });
    vi.mocked(apiClient.post).mockReturnValue(pendingRegistration as never);
    renderRegistration();

    await fillValidRegistration(user);
    fireEvent.submit(getForm());
    fireEvent.submit(getForm());
    await user.keyboard('{Enter}');

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /creando cuenta/i })).toBeDisabled();

    resolveRegistration({ data: registeredUser });
    expect(await screen.findByRole('status')).toHaveTextContent('Cuenta creada. Ahora iniciá sesión.');
  });

  it('keeps the submit lock after the request resolves and before the success navigation runs', async () => {
    const user = userEvent.setup();
    let resolveRegistration!: (value: unknown) => void;
    const pendingRegistration = new Promise((resolve) => {
      resolveRegistration = resolve;
    });
    vi.mocked(apiClient.post).mockReturnValue(pendingRegistration as never);
    renderRegistration();

    await fillValidRegistration(user);
    fireEvent.submit(getForm());
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));

    resolveRegistration({ data: registeredUser });
    await pendingRegistration;
    fireEvent.submit(getForm());

    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('aborts the pending registration request when the page unmounts', async () => {
    const user = userEvent.setup();
    const pendingRegistration = new Promise(() => undefined);
    vi.mocked(apiClient.post).mockReturnValue(pendingRegistration as never);
    const registration = renderRegistration();

    await fillValidRegistration(user);
    fireEvent.submit(getForm());
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));

    const signal = vi.mocked(apiClient.post).mock.calls[0]?.[2]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);

    registration.unmount();

    expect(signal?.aborted).toBe(true);
  });

  it('does not persist or log form secrets or a registration response', async () => {
    const user = userEvent.setup();
    const storageSetItem = vi.spyOn(Storage.prototype, 'setItem');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(apiClient.post).mockResolvedValue({ data: registeredUser } as never);
    renderRegistration();

    await fillValidRegistration(user);
    fireEvent.submit(getForm());

    await screen.findByRole('status');
    expect(storageSetItem).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(window.location.pathname).not.toContain('clave-de-prueba');
  });
});
