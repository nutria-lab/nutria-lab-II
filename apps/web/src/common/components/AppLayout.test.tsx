import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppLayout } from './AppLayout';

describe('AppLayout', () => {
  it('keeps the desktop sidebar while composing the mobile navigation and reserving its safe-area-aware space', () => {
    render(
      <MemoryRouter initialEntries={['/goals']}>
        <AppLayout onLogout={async () => {}}>
          <p>Page content</p>
        </AppLayout>
      </MemoryRouter>,
    );

    const sidebar = screen.getByText('NutrIA').closest('aside');
    expect(sidebar).toHaveClass('hidden', 'md:block');

    expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toBeInTheDocument();

    const content = screen.getByText('Page content').parentElement;
    expect(content).toHaveClass('pb-[calc(5rem+env(safe-area-inset-bottom,0px))]', 'md:pb-0');
  });
});
