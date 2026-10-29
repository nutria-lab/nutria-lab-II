import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { LandingPage } from '@/modules/landing/pages/LandingPage';

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe('LandingPage', () => {
  it('exposes a single h1 with the value proposition', () => {
    renderLanding();

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Planificá tus comidas, recetas y compras en un solo lugar');
  });

  it('lists the three how-it-works steps in order with decorative numerals hidden from assistive tech', () => {
    renderLanding();

    const section = screen.getByRole('region', { name: 'Cómo funciona' });
    const steps = within(section).getAllByRole('listitem');
    expect(within(section).getByRole('list').tagName).toBe('OL');
    expect(steps.map((step) => within(step).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Completá tus preferencias',
      'Armá tu plan',
      'Organizá y registrá',
    ]);

    for (const numeral of ['01', '02', '03']) {
      expect(within(section).getByText(numeral)).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('points every sign-up call to action to /register and every login link to /login', () => {
    renderLanding();

    const signUpLinks = screen.getAllByRole('link', { name: 'Crear cuenta' });
    expect(signUpLinks).toHaveLength(3);
    for (const link of signUpLinks) expect(link).toHaveAttribute('href', '/register');
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Crear cuenta' })).toBeInTheDocument();

    const loginLinks = [
      screen.getByRole('link', { name: 'Iniciar sesión' }),
      ...screen.getAllByRole('link', { name: 'Iniciá sesión' }),
    ];
    expect(loginLinks).toHaveLength(3);
    for (const link of loginLinks) expect(link).toHaveAttribute('href', '/login');
  });

  it('keeps the brand header and closing section and renders no app navigation, forms or remote images', () => {
    renderLanding();

    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('img', { name: 'NutrIA' })).toHaveAttribute(
      'src',
      expect.stringContaining('nutria-wordmark.png'),
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Empezá a organizar tu semana' })).toBeVisible();
    expect(screen.getByRole('contentinfo')).toHaveTextContent('NutrIA');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
    for (const image of Array.from(document.querySelectorAll('img'))) {
      expect(image.getAttribute('src')).not.toMatch(/^https?:/);
    }
  });
});
