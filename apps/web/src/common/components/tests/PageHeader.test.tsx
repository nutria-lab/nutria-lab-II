import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PageHeader } from '../PageHeader';

afterEach(cleanup);

describe('PageHeader', () => {
  it('does not expose any heading so the page keeps a single h1', () => {
    render(<PageHeader />);

    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('shows the default NutrIA brand as text', () => {
    render(<PageHeader />);

    expect(screen.getByText('NutrIA')).toBeVisible();
  });

  it('shows a custom title when provided', () => {
    render(<PageHeader title="Mi marca" />);

    expect(screen.getByText('Mi marca')).toBeVisible();
    expect(screen.queryByText('NutrIA')).toBeNull();
  });

  it('renders the right slot only when provided', () => {
    const { unmount } = render(<PageHeader right={<button type="button">Acción</button>} />);
    expect(screen.getByRole('button', { name: 'Acción' })).toBeVisible();
    unmount();

    const { container } = render(<PageHeader />);
    expect(screen.queryByRole('button')).toBeNull();
    const header = container.querySelector('header');
    expect(header?.children).toHaveLength(1);
  });
});
