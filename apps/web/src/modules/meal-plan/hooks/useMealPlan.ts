import { useCallback, useEffect, useRef, useState } from 'react';
import { mealPlanService, type MealPlan } from '../../../services/mealPlanService';
import { formatLocalDateKey } from '../utils';

type Status = 'loading' | 'empty' | 'error' | 'success';

type UseMealPlanResult = {
  mealPlan: MealPlan | null;
  status: Status;
  errorMessage: string | null;
  retry: () => void;
  generate: () => Promise<void>;
};

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
      .catch(() => {
        if (latestRequestIdRef.current !== requestId) {
          return;
        }
        // No se borra el último `mealPlan` válido: si ya había uno cargado, sigue disponible.
        setStatus('error');
        setErrorMessage('No pudimos cargar tu plan semanal. Intentá de nuevo.');
      });
  }, [weekStart]);

  // NUT-10 (sexta iteración) — Observación 4 del revisor externo: abortar la petición del
  // navegador no cancela la generación en curso del lado del servidor. Si el usuario
  // reintenta mientras la generación anterior sigue en vuelo, un segundo POST puede chocar
  // contra la constraint única `(userId, startDate)` del backend. Esta ref evita que una
  // segunda invocación de `generate()` (directa o vía `retry()`) dispare una nueva llamada
  // al servicio mientras la anterior todavía no resolvió.
  const generationInFlightRef = useRef(false);

  const generate = useCallback(() => {
    if (generationInFlightRef.current) {
      return Promise.resolve();
    }
    generationInFlightRef.current = true;
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
      .catch(() =>
        // NUT-10 (sexta iteración) — Observación 4: antes de reportar error, reconciliamos
        // contra `getCurrentMealPlan`, porque el POST puede haber tenido éxito del lado del
        // servidor pese a que el cliente vio un error/timeout (por ejemplo, el backend sigue
        // corriendo la llamada a Gemini más allá del timeout del cliente).
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
              setStatus('error');
              setErrorMessage('No pudimos generar tu plan semanal. Intentá de nuevo.');
            }
          })
          .catch(() => {
            if (latestRequestIdRef.current !== requestId) {
              return;
            }
            // Reconciliación ambigua: no pudimos confirmar si el plan quedó creado del
            // lado del servidor. Un `retry()` posterior debe reconsultar el estado real
            // (`load`) en vez de disparar otra generación que podría colisionar con una
            // que quizás sigue corriendo.
            lastActionRef.current = 'load';
            setStatus('error');
            setErrorMessage('No pudimos generar tu plan semanal. Intentá de nuevo.');
          }),
      )
      .finally(() => {
        generationInFlightRef.current = false;
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
