import { useCallback, useEffect, useRef, useState } from 'react';

import { recipeService, type Recipe } from '../../../services/recipeService';

type Status = 'loading' | 'empty' | 'error' | 'success';

type UseRecipesResult = {
  recipes: Recipe[];
  status: Status;
  errorMessage: string | null;
  retry: () => void;
  refetch: () => void;
};

// Mismo patrón manual (sin librería de data-fetching) que `useMealPlan.ts`: "última petición
// gana" vía `latestRequestIdRef`, no se borra la última colección válida ante el error de un
// retry/refetch posterior (design.md 1.1/4.2). `retry` y `refetch` comparten la misma
// implementación: ambos vuelven a pedir el listado completo, sólo cambia quién los invoca
// (el propio hook tras un error, o un llamador externo tras una mutación en otro flujo).
export function useRecipes(): UseRecipesResult {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const latestRequestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestId = ++latestRequestIdRef.current;

    setStatus('loading');
    setErrorMessage(null);

    recipeService
      .list(controller.signal)
      .then((data) => {
        if (latestRequestIdRef.current !== requestId) {
          return;
        }
        setRecipes(data);
        setStatus(data.length === 0 ? 'empty' : 'success');
      })
      .catch(() => {
        if (latestRequestIdRef.current !== requestId) {
          return;
        }
        // No se borra la última colección válida: si ya había recetas cargadas, siguen
        // disponibles junto con el error.
        setStatus('error');
        setErrorMessage('No pudimos cargar tus recetas. Intentá de nuevo.');
      });
  }, []);

  useEffect(() => {
    load();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [load]);

  return { recipes, status, errorMessage, retry: load, refetch: load };
}
