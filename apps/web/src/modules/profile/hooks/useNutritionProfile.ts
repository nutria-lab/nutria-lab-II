import { useCallback, useEffect, useState } from 'react';
import {
  nutritionProfileService,
  NutritionProfileNotFoundError,
  type NutritionProfile,
} from '../../../services/nutritionProfileService';

type Status = 'loading' | 'idle' | 'saving' | 'success' | 'error';

const DEFAULT_PROFILE: NutritionProfile = {
  goal: 'LOSE_WEIGHT',
  diet: 'VEGAN',
  excludedIngredients: [],
  cookTimePreference: 'STANDARD',
};

function validateProfile(profile: NutritionProfile): string | null {
  if (!profile.goal || !profile.diet || !profile.cookTimePreference) {
    return 'Completá objetivo, dieta y tiempo de cocina antes de guardar.';
  }
  const uniqueRestrictions = new Set(profile.excludedIngredients);
  if (uniqueRestrictions.size !== profile.excludedIngredients.length) {
    return 'Hay ingredientes excluidos repetidos.';
  }
  return null;
}

export function useNutritionProfile() {
  const [profile, setProfile] = useState<NutritionProfile | null>(null);
  const [isNewProfile, setIsNewProfile] = useState(false);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    nutritionProfileService
      .getProfile()
      .then((data) => {
        setProfile(data);
        setIsNewProfile(false);
        setStatus('idle');
      })
      .catch((error) => {
        // 404 = todavía no hay perfil: no es un fallo técnico, se habilita
        // el formulario con valores por defecto para que el usuario lo complete.
        if (error instanceof NutritionProfileNotFoundError) {
          setProfile(DEFAULT_PROFILE);
          setIsNewProfile(true);
          setStatus('idle');
          return;
        }
        // Un 401 ya dispara el redirect a /login desde el interceptor de `http`;
        // acá solo queda reflejar el error por si el componente sigue montado.
        setStatus('error');
        setErrorMessage('No pudimos cargar tus preferencias. Intentá de nuevo.');
      });
  }, []);

  const save = useCallback(async (next: NutritionProfile) => {
    const validationError = validateProfile(next);
    if (validationError) {
      setStatus('error');
      setErrorMessage(validationError);
      return;
    }

    setStatus('saving');
    setErrorMessage(null);
    try {
      const saved = await nutritionProfileService.updateProfile(next);
      setProfile(saved);
      setIsNewProfile(false);
      setStatus('success');
    } catch {
      // No se toca `next` ni el formState del llamador: sigue disponible para reintentar.
      setStatus('error');
      setErrorMessage('No pudimos guardar tus preferencias. Intentá de nuevo.');
    }
  }, []);

  return { profile, isNewProfile, status, errorMessage, save };
}
