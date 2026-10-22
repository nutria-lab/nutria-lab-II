import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdherenceWidgetProps } from '@/modules/dashboard/adherence-widget/types';
import { AdherenceWidgetSlot } from '@/modules/dashboard/components/AdherenceWidgetSlot';
import { adherenceResponseFixture } from '@/modules/dashboard/fixtures';

afterEach(cleanup);

const PROGRESS_ERROR = 'No pudimos cargar tu progreso.';
const PROGRESS_READY = 'Tu progreso aparecerá aquí.';
const UNAVAILABLE = 'No disponible todavía';
// El error trae dígitos y "%" a propósito: nunca debe llegar a la UI.
const BACKEND_ERROR = 'Error 500: 85%';

function props(overrides: Partial<AdherenceWidgetProps> = {}): AdherenceWidgetProps {
  return { data: null, loading: false, error: null, onRetry: vi.fn(), ...overrides };
}

function renderSlot(slotProps: AdherenceWidgetProps) {
  render(
    <MemoryRouter>
      <AdherenceWidgetSlot {...slotProps} />
    </MemoryRouter>,
  );
  return screen.getByRole('region', { name: 'Progreso semanal' });
}

describe('AdherenceWidgetSlot precedence (§16)', () => {
  it('loading without data: aria-busy skeleton', () => {
    const slot = renderSlot(props({ loading: true }));

    expect(slot.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(within(slot).queryByText(UNAVAILABLE)).not.toBeInTheDocument();
    expect(within(slot).queryByText(PROGRESS_READY)).not.toBeInTheDocument();
  });

  it('loading without data wins over error: skeleton, no error copy nor retry', () => {
    const slot = renderSlot(props({ loading: true, error: BACKEND_ERROR }));

    expect(slot.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(within(slot).queryByText(PROGRESS_ERROR)).not.toBeInTheDocument();
    expect(within(slot).queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('error without data: error copy and "Reintentar" calls onRetry', async () => {
    const onRetry = vi.fn();
    const slot = renderSlot(props({ error: BACKEND_ERROR, onRetry }));

    expect(within(slot).getByText(PROGRESS_ERROR)).toBeInTheDocument();
    expect(slot.querySelector('[aria-busy="true"]')).toBeNull();
    await userEvent.click(within(slot).getByRole('button', { name: 'Reintentar' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('data without error: ready placeholder, no alert nor retry', () => {
    const slot = renderSlot(props({ data: adherenceResponseFixture }));

    expect(within(slot).getByText(PROGRESS_READY)).toBeInTheDocument();
    expect(within(slot).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(slot).queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('data with error: ready placeholder plus a non-blocking alert whose "Reintentar" calls onRetry', async () => {
    const onRetry = vi.fn();
    const slot = renderSlot(props({ data: adherenceResponseFixture, error: BACKEND_ERROR, onRetry }));

    expect(within(slot).getByText(PROGRESS_READY)).toBeInTheDocument();
    expect(within(slot).getByRole('alert')).toBeInTheDocument();
    await userEvent.click(within(slot).getByRole('button', { name: 'Reintentar' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('no data, not loading, no error: "No disponible todavía" without loading indicator', () => {
    const slot = renderSlot(props());

    expect(within(slot).getByText(UNAVAILABLE)).toBeInTheDocument();
    expect(slot.querySelector('[aria-busy="true"]')).toBeNull();
    expect(within(slot).queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it.each<[string, Partial<AdherenceWidgetProps>]>([
    ['loading without data', { loading: true }],
    ['loading with error', { loading: true, error: BACKEND_ERROR }],
    ['error without data', { error: BACKEND_ERROR }],
    ['data without error', { data: adherenceResponseFixture }],
    ['data with error', { data: adherenceResponseFixture, error: BACKEND_ERROR }],
    ['data while loading', { data: adherenceResponseFixture, loading: true }],
    ['nothing', {}],
  ])('never shows digits or "%" (%s)', (_label, overrides) => {
    const slot = renderSlot(props(overrides));

    expect(slot.textContent ?? '').not.toMatch(/\d|%/);
  });
});
