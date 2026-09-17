import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { NavigationItem } from '../NavigationItem';

describe('NavigationItem', () => {
  it('renders the label and icon with inactive styling when route does not match', () => {
    render(
      <MemoryRouter initialEntries={['/other']}>
        <NavigationItem to="/shopping-list" label="Shopping List" icon="cart" />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Shopping List' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/shopping-list');
    expect(link).not.toHaveAttribute('aria-current', 'page');
    expect(link.className).toMatch(/text-stone-500|text-neutral-500|text-on-surface-variant/);
    expect(link.className).toMatch(/font-medium/);

    const icon = link.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('data-active', 'false');
  });

  it('renders active styling with filled icon, bold text, and primary color when route is active', () => {
    render(
      <MemoryRouter initialEntries={['/shopping-list']}>
        <NavigationItem to="/shopping-list" label="Shopping List" icon="cart" />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Shopping List' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link.className).toMatch(/text-brand-green|text-primary|#4a7c59/);
    expect(link.className).toMatch(/font-bold/);

    const icon = link.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('data-active', 'true');
  });

  it('provides accessible touch-target and keyboard focus affordances', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <NavigationItem to="/recipes" label="Recipes" icon="book" />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Recipes' });
    expect(link.className).toMatch(/(?:min-h-11|min-h-\[44px\]|h-20|h-full)/);
    expect(link.className).toMatch(/focus-visible:/);
  });
});
