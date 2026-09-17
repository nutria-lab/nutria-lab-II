import { useCallback, useEffect, useRef, useState } from 'react';

import { ingredientService, type Ingredient } from '../../../services/ingredientService';

type Status = 'loading' | 'empty' | 'error' | 'success';

type UseIngredientsResult = {
  ingredients: Ingredient[];
  status: Status;
  errorMessage: string | null;
  retry: () => void;
  refetch: () => void;
};

// Mismo patrón que `useRecipes.ts` (design.md 1.1), aplicado al catálogo de ingredientes:
// alimenta tanto el listado standalone como el selector de conveniencia del formulario de
// receta. `retry`/`refetch` comparten la misma implementación.
export function useIngredients(): UseIngredientsResult {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
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

    ingredientService
      .list(controller.signal)
      .then((data) => {
        if (latestRequestIdRef.current !== requestId) {
          return;
        }
        setIngredients(data);
        setStatus(data.length === 0 ? 'empty' : 'success');
      })
      .catch(() => {
        if (latestRequestIdRef.current !== requestId) {
          return;
        }
        // No se borra el último catálogo válido: si ya había ingredientes cargados, siguen
        // disponibles junto con el error.
        setStatus('error');
        setErrorMessage('No pudimos cargar el catálogo de ingredientes. Intentá de nuevo.');
      });
  }, []);

  useEffect(() => {
    load();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [load]);

  return { ingredients, status, errorMessage, retry: load, refetch: load };
}
