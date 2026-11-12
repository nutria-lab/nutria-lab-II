import { useEffect, useState } from 'react';

import {
  NutritionProfileNotFoundError,
  nutritionProfileService,
} from '../../../services/nutritionProfileService';

export const NO_PLAN_ACTION_TARGET = '/meal-plan';
export const MISSING_PROFILE_ACTION_TARGET = '/goals';

/**
 * Destino del CTA del estado "sin plan". Sin perfil nutricional no se puede generar un plan,
 * así que el CTA lleva a completar las preferencias. Mientras carga, si la consulta falla o si
 * `enabled` es false, se mantiene el destino de siempre.
 */
export function useNoPlanActionTarget(enabled: boolean): string {
  const [missingProfile, setMissingProfile] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    nutritionProfileService.getProfile().then(
      () => {
        if (active) setMissingProfile(false);
      },
      (error: unknown) => {
        if (active) setMissingProfile(error instanceof NutritionProfileNotFoundError);
      },
    );

    return () => {
      active = false;
    };
  }, [enabled]);

  return enabled && missingProfile ? MISSING_PROFILE_ACTION_TARGET : NO_PLAN_ACTION_TARGET;
}
