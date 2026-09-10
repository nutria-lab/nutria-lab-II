import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesPage } from './PreferencesPage';
import { useNutritionProfile } from '../hooks/useNutritionProfile';
import type { NutritionProfile } from '../../../services/nutritionProfileService';

vi.mock('../hooks/useNutritionProfile', () => ({
  useNutritionProfile: vi.fn(),
}));

const sampleProfile: NutritionProfile = {
  goal: 'LOSE_WEIGHT',
  diet: 'VEGAN',
  excludedIngredients: ['NUTS'],
  cookTimePreference: 'STANDARD',
};

describe('PreferencesPage', () => {
  it('renders the form once the profile loads successfully', () => {
    vi.mocked(useNutritionProfile).mockReturnValue({
      profile: sampleProfile,
      isNewProfile: false,
      status: 'idle',
      errorMessage: null,
      save: vi.fn(),
      retry: vi.fn(),
    });

    render(<PreferencesPage />);

    expect(screen.getByText('Preferencias alimentarias')).toBeInTheDocument();
    expect(screen.queryByText('Cargando tus preferencias...')).not.toBeInTheDocument();
  });

  it('still shows the loading state while the profile has not resolved yet', () => {
    vi.mocked(useNutritionProfile).mockReturnValue({
      profile: null,
      isNewProfile: false,
      status: 'loading',
      errorMessage: null,
      save: vi.fn(),
      retry: vi.fn(),
    });

    render(<PreferencesPage />);

    expect(screen.getByText('Cargando tus preferencias...')).toBeInTheDocument();
  });

  it('shows a recoverable error instead of loading forever when the initial load fails', async () => {
    const retry = vi.fn();
    vi.mocked(useNutritionProfile).mockReturnValue({
      profile: null,
      isNewProfile: false,
      status: 'error',
      errorMessage: 'No pudimos cargar tus preferencias. Intentá de nuevo.',
      save: vi.fn(),
      retry,
    });

    render(<PreferencesPage />);

    expect(screen.queryByText('Cargando tus preferencias...')).not.toBeInTheDocument();
    expect(screen.getByText('No pudimos cargar tus preferencias. Intentá de nuevo.')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(retry).toHaveBeenCalled();
  });
});
