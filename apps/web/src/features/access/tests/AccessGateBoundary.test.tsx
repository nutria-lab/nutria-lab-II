import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { AccessGateBoundary } from '@/features/access/AccessGateBoundary';
import { apiClient } from '@/services/apiClient';

const initialAdapter = apiClient.defaults.adapter;

function response(config: InternalAxiosRequestConfig, data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
}

function renderBoundary() {
  return render(
    <MemoryRouter>
      <AccessGateBoundary>
        <h2>Login real</h2>
      </AccessGateBoundary>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  apiClient.defaults.adapter = initialAdapter;
});

describe('AccessGateBoundary', () => {
  it('keeps authentication behind the gate and submits the access password only once', async () => {
    const user = userEvent.setup();
    let verifyRequests = 0;
    let resolveVerify!: (value: AxiosResponse) => void;
    const verifyPromise = new Promise<AxiosResponse>((resolve) => {
      resolveVerify = resolve;
    });

    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/access/status') {
        return response(config, { required: true, unlocked: false });
      }

      if (config.url === '/access/verify') {
        verifyRequests += 1;
        return verifyPromise;
      }

      throw new Error(`Unexpected request: ${config.url}`);
    };

    renderBoundary();

    expect(await screen.findByRole('heading', { name: 'Acceso privado' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Login real' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Contraseña de acceso'), 'secreta');
    const submit = screen.getByRole('button', { name: 'Continuar' });
    await user.click(submit);
    await user.click(submit);

    expect(verifyRequests).toBe(1);
    expect(screen.getByRole('button', { name: 'Validando acceso...' })).toBeDisabled();

    resolveVerify(response({ url: '/access/verify' } as InternalAxiosRequestConfig, { unlocked: true }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Login real' })).toBeVisible());
  });
});