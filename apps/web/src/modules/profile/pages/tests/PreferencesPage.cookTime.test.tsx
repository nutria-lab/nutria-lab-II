import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferencesPage } from '@/modules/profile/pages/PreferencesPage';
import { nutritionProfileService, type NutritionProfile } from '@/services/nutritionProfileService';

// Integración con el hook real: solo se reemplaza el servicio, que guarda en memoria como lo haría el backend.
vi.mock('@/services/nutritionProfileService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/nutritionProfileService')>()),
  nutritionProfileService: { getProfile: vi.fn(), updateProfile: vi.fn() },
}));

const getProfile = vi.mocked(nutritionProfileService.getProfile);
const updateProfile = vi.mocked(nutritionProfileService.updateProfile);

const PROFILE: NutritionProfile = {
  goal: 'MAINTAIN',
  diet: 'ALL',
  excludedIngredients: [],
  cookTimePreference: 'STANDARD',
};
const SAVE_ERROR = 'No pudimos guardar tus preferencias. Intentá de nuevo.';

let stored: NutritionProfile;

async function renderPage() {
  const view = render(<PreferencesPage />);
  return { ...view, slider: await screen.findByRole<HTMLInputElement>('slider') };
}

function saveButton() {
  return screen.getByRole('button', { name: /Guardar preferencias|Guardando/ });
}

beforeEach(() => {
  stored = PROFILE;
  getProfile.mockReset();
  updateProfile.mockReset();
  getProfile.mockImplementation(async () => stored);
  updateProfile.mockImplementation(async (profile) => {
    stored = profile;
    return profile;
  });
});

describe('PreferencesPage — cook time', () => {
  it.each([
    ['STANDARD', '0', 'QUICK', 'Rápido, 15 minutos'],
    ['QUICK', '1', 'STANDARD', 'Estándar, 30 minutos'],
    ['STANDARD', '2', 'GOURMET', 'Gourmet, 60 minutos'],
  ] as const)('from %s, saving position %s sends %s and a reload keeps it', async (start, position, value, text) => {
    stored = { ...PROFILE, cookTimePreference: start };
    const { slider, unmount } = await renderPage();

    fireEvent.change(slider, { target: { value: position } });
    fireEvent.click(saveButton());

    await screen.findByText('Tus preferencias se guardaron correctamente');
    expect(updateProfile).toHaveBeenCalledExactlyOnceWith({ ...PROFILE, cookTimePreference: value });

    unmount();
    const reloaded = await renderPage();

    expect(reloaded.slider.value).toBe(position);
    expect(reloaded.slider).toHaveAttribute('aria-valuetext', text);
  });

  it('a desktop card saves the same enum as the slider position', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Gourmet/ }));
    fireEvent.click(saveButton());

    await screen.findByText('Tus preferencias se guardaron correctamente');
    expect(updateProfile).toHaveBeenCalledExactlyOnceWith({ ...PROFILE, cookTimePreference: 'GOURMET' });
  });

  it('while saving, the slider and the cards are disabled and keep the selection', async () => {
    let finishSave!: (profile: NutritionProfile) => void;
    updateProfile.mockReturnValue(
      new Promise((resolve) => {
        finishSave = resolve;
      }),
    );
    const { slider } = await renderPage();
    fireEvent.change(slider, { target: { value: '2' } });

    fireEvent.click(saveButton());

    await waitFor(() => expect(slider).toBeDisabled());
    expect(slider.value).toBe('2');
    expect(screen.getByRole('button', { name: /Gourmet/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Rápido/ })).toBeDisabled();

    finishSave({ ...PROFILE, cookTimePreference: 'GOURMET' });
    await waitFor(() => expect(slider).toBeEnabled());
    expect(slider.value).toBe('2');
  });

  describe('with a stored value outside the enum', () => {
    const unknownProfile = { ...PROFILE, cookTimePreference: 'BRUNCH' } as unknown as NutritionProfile;

    it('does not claim the step is complete and does not allow saving it', async () => {
      stored = unknownProfile;
      await renderPage();

      expect(screen.getByText('Sin elegir')).toBeInTheDocument();
      const step = screen.getByText('Tiempo de cocina', { selector: 'p' }).parentElement as HTMLElement;
      expect(within(step).getByText('Pendiente')).toBeInTheDocument();
      expect(screen.getByText('67% completado')).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    it('choosing a valid option enables saving and sends only that option', async () => {
      stored = unknownProfile;
      const { slider } = await renderPage();

      fireEvent.change(slider, { target: { value: '2' } });
      expect(saveButton()).toBeEnabled();
      expect(screen.getByText('100% completado')).toBeInTheDocument();
      fireEvent.click(saveButton());

      await screen.findByText('Tus preferencias se guardaron correctamente');
      expect(updateProfile).toHaveBeenCalledExactlyOnceWith({ ...PROFILE, cookTimePreference: 'GOURMET' });
    });
  });

  it('a failed save keeps the selection, and retrying sends the same enum', async () => {
    updateProfile.mockRejectedValueOnce(new Error('network'));
    const { slider } = await renderPage();
    fireEvent.change(slider, { target: { value: '2' } });

    fireEvent.click(saveButton());

    await screen.findByText(SAVE_ERROR);
    expect(slider).toBeEnabled();
    expect(slider.value).toBe('2');
    expect(slider).toHaveAttribute('aria-valuetext', 'Gourmet, 60 minutos');
    expect(stored.cookTimePreference).toBe('STANDARD');

    fireEvent.click(saveButton());

    await screen.findByText('Tus preferencias se guardaron correctamente');
    expect(updateProfile).toHaveBeenLastCalledWith({ ...PROFILE, cookTimePreference: 'GOURMET' });
    expect(stored.cookTimePreference).toBe('GOURMET');
  });
});
