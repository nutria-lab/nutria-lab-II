import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BrandMark } from './BrandMark';

afterEach(cleanup);

function expectDecorativeOfficialIcon(container: HTMLElement) {
  const icon = container.querySelector('img');

  expect(icon).toHaveAttribute('src', expect.stringContaining('nutria-icon.png'));
  expect(icon).toHaveAttribute('alt', '');
  expect(icon).toHaveAttribute('aria-hidden', 'true');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
}

function expectNoAdditionalFocusableControls(container: HTMLElement) {
  expect(container.querySelectorAll('a, button, input, select, textarea, [tabindex]')).toHaveLength(0);
}

describe('BrandMark', () => {
  it('renders the shared authentication identity with text and the official decorative icon at opposite ends', () => {
    const { container } = render(<BrandMark variant="auth" />);

    expect(screen.getByText('NutrIA')).toBeVisible();
    expect(container.firstElementChild).toHaveClass('flex', 'justify-between');
    expectDecorativeOfficialIcon(container);
    expectNoAdditionalFocusableControls(container);
  });

  it('renders the shared application identity as one centered, accessible brand without duplicating its name', () => {
    const { container } = render(<BrandMark variant="app" />);

    expect(screen.getByText('NutrIA')).toBeVisible();
    expect(container.firstElementChild).toHaveClass('flex', 'justify-center');
    expect(screen.getAllByText('NutrIA')).toHaveLength(1);
    expectDecorativeOfficialIcon(container);
    expectNoAdditionalFocusableControls(container);
  });
});
