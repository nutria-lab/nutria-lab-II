import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { CardState, ShoppingProgress } from '../../types';
import { QuickAccessLinks } from '../QuickAccessLinks';

const PLAN = { id: 'plan-1', version: 1, updatedAt: '2026-10-19T09:00:00.000Z' };
const DEFAULT_DESCRIPTION = 'Ingredientes de tu plan';
const SHOPPING_ERROR = 'No pudimos cargar el avance de tus compras.';

function progress(totalItems: number, checkedItems: number, plan: ShoppingProgress['plan'] = PLAN): ShoppingProgress {
  return { weekStart: '2026-10-19', plan, summary: { totalItems, checkedItems } };
}

function renderLinks(shopping: CardState<ShoppingProgress>) {
  render(
    <MemoryRouter>
      <QuickAccessLinks shopping={shopping} />
    </MemoryRouter>,
  );
  return screen.getByRole('link', { name: /Lista de compras/ });
}

describe('QuickAccessLinks — shopping progress (contract C)', () => {
  it('CA1: shows the contract counters exactly as "X de Y marcados"', () => {
    const link = renderLinks({ kind: 'ready', data: progress(12, 7) });

    expect(within(link).getByText('7 de 12 marcados')).toBeVisible();
    expect(link).toHaveAttribute('href', '/shopping-list');
  });

  it('with a plan but no products says so, without a 0 de 0 counter', () => {
    const link = renderLinks({ kind: 'ready', data: progress(0, 0) });

    expect(within(link).getByText('Todavía no hay productos para marcar.')).toBeVisible();
    expect(screen.queryByText(/de 0 marcados/)).not.toBeInTheDocument();
  });

  it('without a plan keeps the generic description and no counter', () => {
    const link = renderLinks({ kind: 'ready', data: progress(0, 0, null) });

    expect(within(link).getByText(DEFAULT_DESCRIPTION)).toBeVisible();
    expect(screen.queryByText(/marcados/)).not.toBeInTheDocument();
  });

  it.each([
    ['loading', { kind: 'loading' } as const],
    ['unavailable', { kind: 'unavailable' } as const],
  ])('%s keeps the generic description, no counter and no error', (_label, state) => {
    const link = renderLinks(state);

    expect(within(link).getByText(DEFAULT_DESCRIPTION)).toBeVisible();
    expect(screen.queryByText(/marcados/)).not.toBeInTheDocument();
    expect(screen.queryByText(SHOPPING_ERROR)).not.toBeInTheDocument();
  });

  it('error shows fixed copy and a Reintentar button outside the link that calls retry', () => {
    const retry = vi.fn();
    const link = renderLinks({ kind: 'error', retry });

    expect(within(link).getByText(DEFAULT_DESCRIPTION)).toBeVisible();
    expect(screen.getByText(SHOPPING_ERROR)).toBeVisible();
    const button = screen.getByRole('button', { name: 'Reintentar' });
    expect(link).not.toContainElement(button);

    fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('the other two accesses never change', () => {
    renderLinks({ kind: 'error', retry: vi.fn() });

    expect(screen.getByRole('link', { name: /Ver mi plan semanal/ })).toHaveAttribute('href', '/meal-plan');
    expect(screen.getByRole('link', { name: /Explorar recetas/ })).toHaveAttribute('href', '/recipes');
  });
});
