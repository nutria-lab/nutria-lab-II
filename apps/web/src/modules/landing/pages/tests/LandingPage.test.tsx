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

  it('renders the brand header, the closing section and the footer', () => {
    renderLanding();

    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('img', { name: 'NutrIA' })).toHaveAttribute(
      'src',
      expect.stringContaining('nutria-wordmark.png'),
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Empezá a organizar tu semana' })).toBeVisible();
    expect(screen.getByRole('contentinfo')).toHaveTextContent('NutrIA');
  });

  it('loads the closing isotype lazily while the hero isotype loads eagerly', () => {
    renderLanding();

    const heroIsotype = screen.getByRole('heading', { level: 1 }).parentElement!.querySelector('img')!;
    const closingIsotype = screen
      .getByRole('heading', { level: 2, name: 'Empezá a organizar tu semana' })
      .parentElement!.querySelector('img')!;

    expect(heroIsotype).not.toHaveAttribute('loading');
    expect(closingIsotype).toHaveAttribute('loading', 'lazy');
    expect(closingIsotype).toHaveAttribute('decoding', 'async');
  });

  it('places the week preview section between how-it-works and the closing call to action', () => {
    renderLanding();

    const howItWorks = screen.getByRole('region', { name: 'Cómo funciona' });
    const preview = screen.getByRole('region', { name: 'Tu semana, más fácil de visualizar' });
    const closing = screen.getByRole('region', { name: 'Empezá a organizar tu semana' });

    expect(howItWorks.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(preview.compareDocumentPosition(closing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the week preview purely illustrative: hidden from assistive tech, described in text and not interactive', () => {
    renderLanding();

    const preview = screen.getByRole('region', { name: 'Tu semana, más fácil de visualizar' });
    const illustration = preview.querySelector('[aria-hidden="true"][data-preview]');

    expect(illustration).not.toBeNull();
    expect(within(preview).getByText(/vista previa ilustrativa/i)).toHaveClass('sr-only');
    expect(illustration!.querySelectorAll('a, button, input, select, textarea, [tabindex]')).toHaveLength(0);
    expect(within(preview).queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });

  it('shows no user figures in the week preview: no percentages, calories or personal names', () => {
    renderLanding();

    const preview = screen.getByRole('region', { name: 'Tu semana, más fácil de visualizar' });

    expect(preview.textContent).not.toMatch(/%|kcal|calor/i);
    expect(preview.textContent).toMatch(/Hola(?!,)/);
  });

  it('renders no app navigation, forms or remote images', () => {
    renderLanding();

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
    for (const image of Array.from(document.querySelectorAll('img'))) {
      expect(image.getAttribute('src')).not.toMatch(/^https?:/);
    }
  });
});
