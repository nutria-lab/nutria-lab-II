import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RecipeTimeFilterSheet } from './RecipeTimeFilterSheet';

describe('RecipeTimeFilterSheet', () => {
  it('does not render when open is false', () => {
    const { container } = render(
      <RecipeTimeFilterSheet
        open={false}
        onClose={vi.fn()}
        onSelectMinutes={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders accessible dialog with title, options, and radio roles when open is true', () => {
    render(
      <RecipeTimeFilterSheet
        open={true}
        onClose={vi.fn()}
        selectedMinutes={30}
        onSelectMinutes={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: /tiempo de preparación/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const radioGroup = screen.getByRole('radiogroup');
    expect(radioGroup).toBeInTheDocument();

    const option30 = screen.getByRole('radio', { name: /hasta 30 minutos/i });
    expect(option30).toHaveAttribute('aria-checked', 'true');

    const option15 = screen.getByRole('radio', { name: /hasta 15 minutos/i });
    expect(option15).toHaveAttribute('aria-checked', 'false');
  });

  it('selects option and closes when clicked', async () => {
    const user = userEvent.setup();
    const handleSelect = vi.fn();
    const handleClose = vi.fn();

    render(
      <RecipeTimeFilterSheet
        open={true}
        onClose={handleClose}
        onSelectMinutes={handleSelect}
      />,
    );

    await user.click(screen.getByRole('radio', { name: /hasta 15 minutos/i }));

    expect(handleSelect).toHaveBeenCalledWith(15);
    expect(handleClose).toHaveBeenCalled();
  });

  it('closes on Escape key press', async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();

    render(
      <RecipeTimeFilterSheet
        open={true}
        onClose={handleClose}
        onSelectMinutes={vi.fn()}
      />,
    );

    await user.keyboard('{Escape}');
    expect(handleClose).toHaveBeenCalled();
  });

  it('closes when close button is clicked', async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();

    render(
      <RecipeTimeFilterSheet
        open={true}
        onClose={handleClose}
        onSelectMinutes={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /cerrar filtro de tiempo/i }));
    expect(handleClose).toHaveBeenCalled();
  });
});
