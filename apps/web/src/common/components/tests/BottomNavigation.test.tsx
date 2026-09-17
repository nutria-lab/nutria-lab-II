import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BottomNavigation } from '../BottomNavigation';

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Meal Plan', path: '/meal-plan' },
  { label: 'Recipes', path: '/recipes' },
  { label: 'Shopping List', path: '/shopping-list' },
  { label: 'Goals', path: '/goals' },
];

function LocationProbe() {
  const location = useLocation();

  return <output aria-label="Current path">{location.pathname}</output>;
}

describe('BottomNavigation', () => {
  it('renders the existing primary routes as labelled mobile links with a single active destination', () => {
    render(
      <MemoryRouter initialEntries={['/meal-plan']}>
        <BottomNavigation />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', { name: 'Mobile navigation' });

    expect(navigation).toHaveClass('fixed', 'bottom-0', 'md:hidden');

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(NAV_ITEMS.length);
    expect(links.map((link) => link.textContent?.trim())).toEqual(NAV_ITEMS.map((item) => item.label));

    for (const item of NAV_ITEMS) {
      expect(screen.getByRole('link', { name: item.label })).toHaveAttribute('href', item.path);
    }

    const activeLink = screen.getByRole('link', { name: 'Meal Plan' });
    expect(activeLink).toHaveAttribute('aria-current', 'page');
    expect(activeLink.className).toMatch(/(?:border-t|font-bold|font-semibold|underline)/);
    expect(screen.queryAllByRole('link', { current: 'page' })).toHaveLength(1);
  });

  it('navigates with keyboard-accessible links that expose focus and touch-target affordances', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <BottomNavigation />
        <LocationProbe />
      </MemoryRouter>,
    );

    const recipesLink = screen.getByRole('link', { name: 'Recipes' });
    expect(recipesLink.className).toMatch(/focus-visible:/);
    expect(recipesLink.className).toMatch(/(?:min-h-11|min-h-\[44px\]|h-11)/);

    await user.click(recipesLink);

    expect(screen.getByRole('link', { name: 'Recipes' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/recipes');
  });

  it('adds the safe-area inset to a usable base padding', () => {
    render(
      <MemoryRouter>
        <BottomNavigation />
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toHaveClass(
      'pb-[env(safe-area-inset-bottom,0px)]',
    );
  });
});
