import { useCallback, useEffect, useState } from 'react';
import { mealPlanService, type MealPlan } from '../../../services/mealPlanService';
import { formatLocalDateKey } from '../utils';

type Status = 'loading' | 'empty' | 'error' | 'success';

function getCurrentWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  return formatLocalDateKey(monday);
}

export function useMealPlan(weekStart: string = getCurrentWeekStart()) {
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    setStatus('loading');
    setErrorMessage(null);

    mealPlanService
      .getCurrentMealPlan(weekStart)
      .then((data) => {
        if (data) {
          setMealPlan(data);
          setStatus('success');
        } else {
          setMealPlan(null);
          setStatus('empty');
        }
      })
      .catch(() => {
        // No se borra el último `mealPlan` válido: si ya había uno cargado, sigue disponible.
        setStatus('error');
        setErrorMessage('No pudimos cargar tu plan semanal. Intentá de nuevo.');
      });
  }, [weekStart]);

  useEffect(() => {
    load();
  }, [load]);

  return { mealPlan, status, errorMessage, retry: load };
}
