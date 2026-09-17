import { useCallback, useEffect, useRef, useState } from 'react';

import { recipeService, RecipeRequestError, type Recipe } from '../../../services/recipeService';

type Status = 'loading' | 'notFound' | 'error' | 'success';

type UseRecipeDetailResult = {
  recipe: Recipe | null;
  status: Status;
  errorMessage: string | null;
  retry: () => void;
};

// Hook de detalle por id (design.md 1.1): estado propio, independiente del listado. A
// diferencia de `useRecipes`, no tiene `'empty'` (no aplica a un único recurso) y sí un
// `'notFound'` propio para el caso de 404 (design.md 1.3/4.2 — pantalla de "no encontrada"
// distinta del error genérico). Recarga cuando cambia `id` entre renders.
export function useRecipeDetail(id: string): UseRecipeDetailResult {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const latestRequestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentIdRef = useRef(id);
  currentIdRef.current = id;
  // Id al que pertenece el `recipe` actualmente guardado en estado (bug 3, NUT-20): permite
  // distinguir un retry() del MISMO id (donde hay que preservar el último dato válido) de un
  // cambio de id (navegación a otra receta) cuyo fetch falla, caso en el que no hay que seguir
  // mostrando la receta anterior bajo una URL que ya apunta a otra.
  const recipeIdRef = useRef<string | null>(null);

  const load = useCallback(() => {
    const targetId = currentIdRef.current;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestId = ++latestRequestIdRef.current;

    setStatus('loading');
    setErrorMessage(null);

    recipeService
      .getById(targetId, controller.signal)
      .then((data) => {
        if (latestRequestIdRef.current !== requestId) {
          return;
        }
        recipeIdRef.current = targetId;
        setRecipe(data);
        setStatus('success');
      })
      .catch((error) => {
        if (latestRequestIdRef.current !== requestId) {
          return;
        }
        if (error instanceof RecipeRequestError && error.kind === 'notFound') {
          recipeIdRef.current = null;
          setRecipe(null);
          setStatus('notFound');
          return;
        }
        // Hallazgo 3 (alto, cuarto review): a diferencia de "notFound" (el recurso realmente
        // dejó de existir), cualquier otro error es potencialmente transitorio (red, hipo del
        // backend) y no debe pisar un dato ya válido en pantalla — mismo criterio que
        // `useRecipes`/`useIngredients`/`useMealPlan`. Pero eso sólo aplica cuando se reintenta
        // el MISMO id que ya tenía cargado: si `id` cambió (navegación a otra receta), el
        // `recipe` en estado pertenece a un id distinto del que se acaba de pedir sin éxito y
        // hay que limpiarlo para no seguir mostrando la receta anterior bajo la URL nueva.
        if (recipeIdRef.current !== targetId) {
          setRecipe(null);
        }
        setStatus('error');
        setErrorMessage('No pudimos cargar esta receta. Intentá de nuevo.');
      });
  }, []);

  useEffect(() => {
    load();
    return () => {
      abortControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, load]);

  return { recipe, status, errorMessage, retry: load };
}
