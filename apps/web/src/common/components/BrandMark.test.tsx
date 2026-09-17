import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BrandMark } from './BrandMark';

afterEach(cleanup);

function expectOfficialBrandAssets(container: HTMLElement) {
  const [wordmark, isotype] = Array.from(container.querySelectorAll('img'));

  expect(wordmark).toHaveAttribute('src', expect.stringContaining('nutria-wordmark.png'));
  expect(wordmark).toHaveAttribute('alt', 'NutrIA');
  expect(isotype).toHaveAttribute('src', expect.stringContaining('nutria-isotype.png'));
  expect(isotype).toHaveAttribute('alt', '');
  expect(isotype).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getAllByRole('img', { name: 'NutrIA' })).toHaveLength(1);
}

function expectNoAdditionalFocusableControls(container: HTMLElement) {
  expect(container.querySelectorAll('a, button, input, select, textarea, [tabindex]')).toHaveLength(0);
}

describe('BrandMark', () => {
  it('renders the official Linear wordmark first and its decorative isotype second for authentication', () => {
    const { container } = render(<BrandMark variant="auth" />);

    expect(container.firstElementChild).toHaveClass('flex', 'justify-center');
    expect(container.firstElementChild).toHaveClass('min-w-0');
    expectOfficialBrandAssets(container);
    expectNoAdditionalFocusableControls(container);
  });

  it('renders both official assets together for the application without duplicating its accessible name', () => {
    const { container } = render(<BrandMark variant="app" />);

    expect(container.firstElementChild).toHaveClass('flex', 'justify-center');
    expect(container.firstElementChild).toHaveClass('min-w-0');
    expectOfficialBrandAssets(container);
    expectNoAdditionalFocusableControls(container);
  });
});
