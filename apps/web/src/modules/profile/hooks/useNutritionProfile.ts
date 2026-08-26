import { useCallback, useEffect, useState } from 'react';
import { nutritionProfileService, type NutritionProfile } from '../../../services/nutritionProfileService';

type Status = 'loading' | 'idle' | 'saving' | 'success' | 'error';

export function useNutritionProfile() {
  const [profile, setProfile] = useState<NutritionProfile | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    nutritionProfileService
      .getProfile()
      .then((data) => {
        setProfile(data);
        setStatus('idle');
      })
      .catch(() => {
        setStatus('error');
        setErrorMessage('No pudimos cargar tus preferencias. Intentá de nuevo.');
      });
  }, []);

  const save = useCallback(async (next: NutritionProfile) => {
    setStatus('saving');
    setErrorMessage(null);
    try {
      const saved = await nutritionProfileService.updateProfile(next);
      setProfile(saved);
      setStatus('success');
    } catch {
      setStatus('error');
      setErrorMessage('No pudimos guardar tus preferencias. Intentá de nuevo.');
    }
  }, []);

  return { profile, status, errorMessage, save };
}
