import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { Sidebar } from './Sidebar';

afterEach(cleanup);

describe('Sidebar', () => {
  it('uses the shared, grouped application mark without changing the existing navigation links', () => {
    const { container } = render(
      <MemoryRouter>
        <Sidebar onLogout={async () => undefined} />
      </MemoryRouter>,
    );

    const [wordmark, isotype] = Array.from(container.querySelectorAll('img'));
    expect(wordmark).toHaveAttribute('src', expect.stringContaining('nutria-wordmark.png'));
    expect(wordmark).toHaveAttribute('alt', 'NutrIA');
    expect(isotype).toHaveAttribute('src', expect.stringContaining('nutria-isotype.png'));
    expect(isotype).toHaveAttribute('alt', '');
    expect(isotype).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByRole('img', { name: 'NutrIA' })).toHaveLength(1);
    expect(wordmark?.parentElement).toHaveClass('justify-center', 'min-w-0');

    expect(screen.getByRole('link', { name: 'Goals' })).toHaveAttribute('href', '/goals');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
  });
});
