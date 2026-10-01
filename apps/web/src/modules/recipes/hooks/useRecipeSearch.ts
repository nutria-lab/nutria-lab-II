import { useCallback, useEffect, useRef, useState } from 'react';

import {
  recipeService,
  type Recipe,
  type RecipeErrorKind,
} from '../../../services/recipeService';

export const RECIPE_SEARCH_SESSION_KEY = 'nutria_recipe_search_state';
export const DEBOUNCE_DELAY_MS = 300;
export const DEFAULT_PAGE_SIZE = 4;

export type RecipeSearchState = {
  draftText: string;
  committedQuery?: string;
  properties: string[];
  maxPrepMinutes?: number;
  page: number;
};

export type PersistedRecipeSearch = {
  searchState: RecipeSearchState;
  recipes: Recipe[];
  total: number;
  scrollY?: number;
};

export type UseRecipeSearchOptions = {
  initialQuery?: string;
  pageSize?: number;
  enableSessionPersistence?: boolean;
  enabled?: boolean;
};

export type UseRecipeSearchResult = {
  draftText: string;
  committedQuery?: string;
  properties: string[];
  maxPrepMinutes?: number;
  page: number;
  pageSize: number;

  recipes: Recipe[];
  total: number;
  status: 'loading' | 'empty' | 'error' | 'success';
  isFetchingMore: boolean;
  hasMore: boolean;
  errorMessage: string | null;
  errorKind: RecipeErrorKind | null;

  setDraftText: (text: string) => void;
  toggleProperty: (property: string) => void;
  setMaxPrepMinutes: (minutes?: number) => void;
  clearFilters: () => void;
  loadMore: () => void;
  retry: () => void;
  refetch: () => void;
};

export function clearPersistedRecipeSearch() {
  try {
    sessionStorage.removeItem(RECIPE_SEARCH_SESSION_KEY);
  } catch {
    // Ignore storage errors
  }
}

function loadPersisted(): PersistedRecipeSearch | null {
  try {
    const raw = sessionStorage.getItem(RECIPE_SEARCH_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

type QueryResultState = {
  recipes: Recipe[];
  total: number;
  status: 'loading' | 'empty' | 'error' | 'success';
  isFetchingMore: boolean;
  errorMessage: string | null;
  errorKind: RecipeErrorKind | null;
};

export function useRecipeSearch({
  initialQuery,
  pageSize = DEFAULT_PAGE_SIZE,
  enableSessionPersistence = true,
  enabled = true,
}: UseRecipeSearchOptions = {}): UseRecipeSearchResult {
  const persisted = useRef(enabled && enableSessionPersistence ? loadPersisted() : null).current;

  // Si viene un initialQuery explícito (ej: URL ?q=quinoa), tiene prioridad sobre el estado persistido
  const hasExplicitInitialQuery = Boolean(initialQuery && initialQuery.trim());
  const initialCommitted = hasExplicitInitialQuery
    ? initialQuery?.trim()
    : persisted?.searchState.committedQuery;
  const initialDraft = hasExplicitInitialQuery
    ? (initialQuery ?? '')
    : (persisted?.searchState.draftText ?? '');

  // Estado 1: searchState (fuente de verdad de los filtros)
  const [searchState, setSearchState] = useState<RecipeSearchState>(() => ({
    draftText: initialDraft,
    committedQuery: initialCommitted,
    properties: hasExplicitInitialQuery ? [] : (persisted?.searchState.properties ?? []),
    maxPrepMinutes: hasExplicitInitialQuery ? undefined : persisted?.searchState.maxPrepMinutes,
    page: hasExplicitInitialQuery ? 1 : (persisted?.searchState.page ?? 1),
  }));

  // Estado 2: queryResult (respuesta del backend y estados de carga)
  const [queryResult, setQueryResult] = useState<QueryResultState>(() => {
    if (hasExplicitInitialQuery) {
      return {
        recipes: [],
        total: 0,
        status: 'loading',
        isFetchingMore: false,
        errorMessage: null,
        errorKind: null,
      };
    }
    return {
      recipes: persisted?.recipes ?? [],
      total: persisted?.total ?? 0,
      status: persisted ? (persisted.recipes.length === 0 ? 'empty' : 'success') : 'loading',
      isFetchingMore: false,
      errorMessage: null,
      errorKind: null,
    };
  });

  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const isInitialMount = useRef(true);

  // 1. Debounce de 300ms: draftText -> committedQuery
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      const trimmed = searchState.draftText.trim();
      const nextQuery = trimmed || undefined;
      setSearchState((prev) => {
        if (prev.committedQuery === nextQuery) return prev;
        return { ...prev, committedQuery: nextQuery, page: 1 };
      });
    }, DEBOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, searchState.draftText]);

  // 2. Ejecución de la consulta en el backend
  const { committedQuery, properties, maxPrepMinutes, page } = searchState;

  const fetchRecipes = useCallback(
    (targetPage: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const currentId = ++reqIdRef.current;

      const isFirstPage = targetPage === 1;
      setQueryResult((prev) => ({
        ...prev,
        status: isFirstPage ? 'loading' : prev.status,
        isFetchingMore: !isFirstPage,
        errorMessage: null,
        errorKind: null,
      }));

      recipeService
        .search(
          {
            q: committedQuery,
            properties: properties.length > 0 ? properties : undefined,
            maxPrepMinutes,
            page: targetPage,
            pageSize,
          },
          controller.signal,
        )
        .then((data) => {
          if (reqIdRef.current !== currentId) return;

          // Solo avanzar page en searchState cuando la petición tuvo éxito:
          setSearchState((prev) => ({ ...prev, page: targetPage }));

          setQueryResult((prev) => ({
            ...prev,
            recipes: isFirstPage
              ? data.items
              : [
                  ...prev.recipes,
                  ...data.items.filter((item) => !prev.recipes.some((r) => r.id === item.id)),
                ],
            total: data.total,
            status: isFirstPage && data.items.length === 0 ? 'empty' : 'success',
            isFetchingMore: false,
          }));
        })
        .catch((err: unknown) => {
          if (reqIdRef.current !== currentId) return;
          const kind: RecipeErrorKind = (err as { kind?: RecipeErrorKind })?.kind ?? 'network';
          setQueryResult((prev) => ({
            ...prev,
            errorKind: kind,
            errorMessage:
              kind === 'validation'
                ? 'Los parámetros de búsqueda son inválidos. Verificá los filtros.'
                : 'No pudimos cargar las recetas. Verificá tu conexión e intentá de nuevo.',
            status: 'error',
            isFetchingMore: false,
          }));
        });
    },
    [committedQuery, properties, maxPrepMinutes, pageSize],
  );

  // 3. Efecto de búsqueda ante cambios de página o filtros estabilizados
  useEffect(() => {
    if (!enabled) return;
    if (isInitialMount.current) {
      isInitialMount.current = false;
      if (!hasExplicitInitialQuery && persisted && persisted.recipes.length > 0) return;
    }
    fetchRecipes(page);
    return () => abortRef.current?.abort();
  }, [enabled, fetchRecipes, page]);

  // 4. Persistencia en sessionStorage
  useEffect(() => {
    if (!enabled || !enableSessionPersistence) return;
    try {
      sessionStorage.setItem(
        RECIPE_SEARCH_SESSION_KEY,
        JSON.stringify({
          searchState,
          recipes: queryResult.recipes,
          total: queryResult.total,
        }),
      );
    } catch {
      // Ignore storage errors
    }
  }, [enabled, enableSessionPersistence, searchState, queryResult.recipes, queryResult.total]);

  // 5. Acciones de usuario
  const setDraftText = useCallback((text: string) => {
    setSearchState((prev) => ({ ...prev, draftText: text }));
  }, []);

  const toggleProperty = useCallback((prop: string) => {
    setSearchState((prev) => {
      const nextProps = prev.properties.includes(prop)
        ? prev.properties.filter((p) => p !== prop)
        : [...prev.properties, prop];
      return { ...prev, properties: nextProps, page: 1 };
    });
  }, []);

  const setMaxPrepMinutes = useCallback((minutes?: number) => {
    setSearchState((prev) => ({ ...prev, maxPrepMinutes: minutes, page: 1 }));
  }, []);

  const clearFilters = useCallback(() => {
    setSearchState({
      draftText: '',
      committedQuery: undefined,
      properties: [],
      maxPrepMinutes: undefined,
      page: 1,
    });
    clearPersistedRecipeSearch();
  }, []);

  const hasMore = queryResult.recipes.length < queryResult.total;

  const loadMore = useCallback(() => {
    if (!queryResult.isFetchingMore && hasMore) {
      fetchRecipes(searchState.page + 1);
    }
  }, [queryResult.isFetchingMore, hasMore, fetchRecipes, searchState.page]);

  const retry = useCallback(() => {
    const target =
      queryResult.recipes.length > 0 && queryResult.recipes.length < queryResult.total
        ? searchState.page + 1
        : searchState.page;
    fetchRecipes(target);
  }, [fetchRecipes, queryResult.recipes.length, queryResult.total, searchState.page]);

  return {
    draftText: searchState.draftText,
    committedQuery: searchState.committedQuery,
    properties: searchState.properties,
    maxPrepMinutes: searchState.maxPrepMinutes,
    page: searchState.page,
    pageSize,

    recipes: queryResult.recipes,
    total: queryResult.total,
    status: queryResult.status,
    isFetchingMore: queryResult.isFetchingMore,
    hasMore,
    errorMessage: queryResult.errorMessage,
    errorKind: queryResult.errorKind,

    setDraftText,
    toggleProperty,
    setMaxPrepMinutes,
    clearFilters,
    loadMore,
    retry,
    refetch: retry,
  };
}
