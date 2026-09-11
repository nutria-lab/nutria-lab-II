import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { Sidebar } from './Sidebar';

afterEach(cleanup);

describe('Sidebar', () => {
  it('uses the shared, grouped application mark without changing the existing navigation links', () => {
    const { container } = render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.getByText('NutrIA')).toBeVisible();
    const icon = container.querySelector('img');
    expect(icon).toHaveAttribute('src', expect.stringContaining('nutria-icon.png'));
    expect(icon).toHaveAttribute('alt', '');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(icon?.parentElement).toHaveClass('justify-center');

    expect(screen.getByRole('link', { name: 'Goals' })).toHaveAttribute('href', '/goals');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
  });
});
