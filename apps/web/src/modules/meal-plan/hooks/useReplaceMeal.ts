import { useCallback, useRef, useState } from 'react';
import { mealPlanService, type PlannedMeal } from '../../../services/mealPlanService';

export type ReplaceMealError = {
  mealId: string;
  mealTitle: string;
  message: string;
  idempotencyKey: string;
  originalMeal: PlannedMeal;
};

type UseReplaceMealOptions = {
  onSuccess?: (updatedMeal: PlannedMeal, previousMeal: PlannedMeal) => void;
  onError?: (error: ReplaceMealError) => void;
};

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function useReplaceMeal(options: UseReplaceMealOptions = {}) {
  const { onSuccess, onError } = options;

  const [replacingMealId, setReplacingMealId] = useState<string | null>(null);
  const [replaceError, setReplaceError] = useState<ReplaceMealError | null>(null);

  // Guarda la intención activa para retry y evita doble submit
  const inFlightRef = useRef(false);
  const activeIntentRef = useRef<{
    planId: string;
    meal: PlannedMeal;
    idempotencyKey: string;
    body?: Record<string, unknown>;
  } | null>(null);

  const executeReplace = useCallback(
    async (
      planId: string,
      meal: PlannedMeal,
      idempotencyKey: string,
      body?: Record<string, unknown>,
    ): Promise<PlannedMeal | null> => {
      if (inFlightRef.current) {
        return null;
      }

      inFlightRef.current = true;
      setReplacingMealId(meal.id);
      setReplaceError(null);

      activeIntentRef.current = {
        planId,
        meal,
        idempotencyKey,
        body,
      };

      try {
        const updatedMeal = await mealPlanService.replacePlannedMeal(
          planId,
          meal.id,
          idempotencyKey,
          body,
        );

        setReplacingMealId(null);
        setReplaceError(null);
        activeIntentRef.current = null;

        onSuccess?.(updatedMeal, meal);
        return updatedMeal;
      } catch (err) {
        setReplacingMealId(null);

        const errorPayload: ReplaceMealError = {
          mealId: meal.id,
          mealTitle: meal.recipe?.title ?? meal.title,
          message:
            err instanceof Error && err.message
              ? err.message
              : 'No pudimos reemplazar la comida. Podés reintentar o cancelar.',
          idempotencyKey,
          originalMeal: meal,
        };

        setReplaceError(errorPayload);
        onError?.(errorPayload);
        return null;
      } finally {
        inFlightRef.current = false;
      }
    },
    [onError, onSuccess],
  );

  const replaceMeal = useCallback(
    (planId: string, meal: PlannedMeal, body?: Record<string, unknown>) => {
      const key = generateIdempotencyKey();
      return executeReplace(planId, meal, key, body);
    },
    [executeReplace],
  );

  const retryReplace = useCallback(() => {
    if (!activeIntentRef.current && replaceError) {
      // Reconstituye el intent si fue cancelado o desfasado
      return executeReplace(
        (activeIntentRef.current as any)?.planId ?? '',
        replaceError.originalMeal,
        replaceError.idempotencyKey,
      );
    }
    if (!activeIntentRef.current) {
      return Promise.resolve(null);
    }
    const { planId, meal, idempotencyKey, body } = activeIntentRef.current;
    return executeReplace(planId, meal, idempotencyKey, body);
  }, [executeReplace, replaceError]);

  const cancelReplaceError = useCallback(() => {
    setReplaceError(null);
    activeIntentRef.current = null;
  }, []);

  const isReplacing = useCallback(
    (mealId: string) => replacingMealId === mealId,
    [replacingMealId],
  );

  return {
    replacingMealId,
    replaceError,
    isReplacing,
    replaceMeal,
    retryReplace,
    cancelReplaceError,
    isSubmitting: inFlightRef.current,
  };
}
