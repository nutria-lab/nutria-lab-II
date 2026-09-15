import { useCallback, useEffect, useRef, useState } from 'react';
import { mealPlanService, MealPlanRequestError, type MealPlan } from '../../../services/mealPlanService';
import { formatLocalDateKey } from '../utils';

type Status = 'loading' | 'empty' | 'error' | 'success' | 'unauthorized';

type UseMealPlanResult = {
  mealPlan: MealPlan | null;
  status: Status;
  errorMessage: string | null;
  retry: () => void;
  generate: () => Promise<void>;
};

function isMealPlanUnauthorizedError(error: unknown): boolean {
  return error instanceof MealPlanRequestError && error.kind === 'unauthorized';
}

function getCurrentWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  return formatLocalDateKey(monday);
}

export function useMealPlan(weekStart: string = getCurrentWeekStart()): UseMealPlanResult {
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // "Última petición gana": cada invocación de `load`/`generate` recibe un id propio y
  // aborta la petición en vuelo anterior. Si una respuesta obsoleta llega tarde (por
  // ejemplo, tras un doble-render de StrictMode o dos "Reintentar" seguidos), se ignora en
  // vez de pisar el estado ya actualizado por una petición más nueva.
  const latestRequestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Recuerda cuál fue la última acción disparada para que `retry` repita esa acción
  // (`load` o `generate`), no siempre `load`.
  const lastActionRef = useRef<'load' | 'generate'>('load');

  const load = useCallback(() => {
    lastActionRef.current = 'load';

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestId = ++latestRequestIdRef.current;

    setStatus('loading');
    setErrorMessage(null);

    mealPlanService
      .getCurrentMealPlan(weekStart, controller.signal)
      .then((data) => {
        if (latestRequestIdRef.current !== requestId) {
          return;
        }
        if (data) {
          setMealPlan(data);
          setStatus('success');
        } else {
          setMealPlan(null);
          setStatus('empty');
        }
      })
      .catch((error) => {
        if (latestRequestIdRef.current !== requestId) {
          return;
        }
        if (isMealPlanUnauthorizedError(error)) {
          setStatus('unauthorized');
          return;
        }
        // No se borra el último `mealPlan` válido: si ya había uno cargado, sigue disponible.
        setStatus('error');
        setErrorMessage('No pudimos cargar tu plan semanal. Intentá de nuevo.');
      });
  }, [weekStart]);

  const generate = useCallback(() => {
    lastActionRef.current = 'generate';

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestId = ++latestRequestIdRef.current;

    setStatus('loading');
    setErrorMessage(null);

    return mealPlanService
      .generateMealPlan(weekStart, controller.signal)
      .then((data) => {
        if (latestRequestIdRef.current !== requestId) {
          return;
        }
        if (data) {
          setMealPlan(data);
          setStatus('success');
        } else {
          setMealPlan(null);
          setStatus('empty');
        }
      })
      .catch((error) => {
        if (latestRequestIdRef.current !== requestId) {
          return;
        }
        if (isMealPlanUnauthorizedError(error)) {
          setStatus('unauthorized');
          return;
        }
        setStatus('error');
        setErrorMessage('No pudimos generar tu plan semanal. Intentá de nuevo.');
      });
  }, [weekStart]);

  const retry = useCallback(() => {
    if (lastActionRef.current === 'generate') {
      generate();
      return;
    }
    load();
  }, [generate, load]);

  useEffect(() => {
    load();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [load]);

  return { mealPlan, status, errorMessage, retry, generate };
}
