import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";

import { shoppingListService } from "../../../services/shoppingListService";
import type {
  ShoppingListCheckRequest,
  ShoppingListItemError,
  ShoppingListResponse,
} from "../types";

type ViewState = "loading" | "success" | "error";

function errorDetails(error: unknown) {
  if (!axios.isAxiosError(error)) return { status: 0, code: undefined };
  const data = error.response?.data;
  return {
    status: error.response?.status ?? 0,
    code:
      data && typeof data === "object"
        ? (data as { code?: unknown }).code
        : undefined,
  };
}

export function useShoppingList(
  weekStart: string,
  sessionIdentity: object | null,
  authenticated: boolean,
) {
  const [state, setState] = useState<ViewState>("loading");
  const [response, setResponse] = useState<ShoppingListResponse>();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [itemErrors, setItemErrors] = useState<
    Record<string, ShoppingListItemError>
  >({});
  const [stale, setStale] = useState(false);
  const [conflictNotice, setConflictNotice] = useState(false);
  const loadGeneration = useRef(0);
  const activeRead = useRef<AbortController | undefined>(undefined);
  const currentContext = useRef({ weekStart, sessionIdentity, authenticated });
  const confirmed = useRef<ShoppingListResponse | undefined>(undefined);
  const lockedItems = useRef(new Set<string>());
  const writes = useRef(new Map<string, Promise<void>>());
  const errorRef = useRef(itemErrors);
  const staleRef = useRef(false);
  const reconciliation = useRef(false);
  currentContext.current = { weekStart, sessionIdentity, authenticated };
  confirmed.current = response;
  errorRef.current = itemErrors;

  const setErrors = useCallback(
    (
      update: (
        current: Record<string, ShoppingListItemError>,
      ) => Record<string, ShoppingListItemError>,
    ) => {
      setItemErrors((current) => {
        const next = update(current);
        errorRef.current = next;
        return next;
      });
    },
    [],
  );

  const load = useCallback(async () => {
    const context = currentContext.current;
    if (!context.authenticated || !context.sessionIdentity) return;
    const generation = ++loadGeneration.current;
    activeRead.current?.abort();
    setState("loading");
    setResponse(undefined);
    confirmed.current = undefined;
    await Promise.allSettled([...writes.current.values()]);
    if (
      generation !== loadGeneration.current ||
      currentContext.current.weekStart !== context.weekStart ||
      currentContext.current.sessionIdentity !== context.sessionIdentity
    )
      return;
    const controller = new AbortController();
    activeRead.current = controller;
    setItemErrors({});
    errorRef.current = {};
    setStale(false);
    staleRef.current = false;
    reconciliation.current = false;
    const isCurrent = () =>
      loadGeneration.current === generation &&
      currentContext.current.weekStart === context.weekStart &&
      currentContext.current.sessionIdentity === context.sessionIdentity &&
      currentContext.current.authenticated;

    try {
      const next = await shoppingListService.getForWeek(context.weekStart, {
        signal: controller.signal,
        isRequestCurrent: isCurrent,
      });
      if (!isCurrent()) return;
      setResponse(next);
      confirmed.current = next;
      setState("success");
    } catch (error) {
      if (!isCurrent() || axios.isCancel(error) || controller.signal.aborted)
        return;
      setState("error");
    }
  }, []);

  useEffect(() => {
    const context = { weekStart, sessionIdentity, authenticated };
    currentContext.current = context;
    if (!authenticated || !sessionIdentity) {
      setState("loading");
      setResponse(undefined);
      return undefined;
    }
    setPending({});
    lockedItems.current.clear();
    setItemErrors({});
    errorRef.current = {};
    setStale(false);
    setConflictNotice(false);
    staleRef.current = false;
    reconciliation.current = false;
    void load();
    return () => {
      loadGeneration.current += 1;
      activeRead.current?.abort();
    };
  }, [weekStart, sessionIdentity, authenticated, load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  const sendCheck = useCallback(
    (itemKey: string, checked: boolean) => {
      const snapshot = confirmed.current;
      const context = currentContext.current;
      if (
        !snapshot?.plan ||
        !context.sessionIdentity ||
        !context.authenticated ||
        staleRef.current
      )
        return;
      const item = snapshot.items.find((entry) => entry.key === itemKey);
      if (!item || lockedItems.current.has(itemKey)) return;
      const planId = snapshot.plan.id;
      const planUpdatedAt = snapshot.plan.updatedAt;
      const generation = loadGeneration.current;
      const isCurrent = () =>
        loadGeneration.current === generation &&
        currentContext.current.weekStart === context.weekStart &&
        currentContext.current.sessionIdentity === context.sessionIdentity &&
        currentContext.current.authenticated &&
        confirmed.current?.plan?.id === planId &&
        confirmed.current.plan.updatedAt === planUpdatedAt;
      lockedItems.current.add(itemKey);
      setPending((current) => ({ ...current, [itemKey]: true }));
      setErrors((current) => {
        const next = { ...current };
        delete next[itemKey];
        return next;
      });
      const input: ShoppingListCheckRequest = {
        planId,
        planUpdatedAt,
        checked,
      };
      const controller = new AbortController();
      let gotStale = false;
      const operation = Promise.resolve().then(async () => {
        try {
          await shoppingListService.setItemChecked(itemKey, input, {
            signal: controller.signal,
            isRequestCurrent: isCurrent,
          });
          if (!isCurrent() || staleRef.current) return;
          setResponse((current) => {
            if (
              !current ||
              current.plan?.id !== planId ||
              current.plan.updatedAt !== planUpdatedAt
            )
              return current;
            const items = current.items.map((entry) =>
              entry.key === itemKey ? { ...entry, checked } : entry,
            );
            return {
              ...current,
              items,
              summary: {
                totalItems: items.length,
                checkedItems: items.filter((entry) => entry.checked).length,
              },
            };
          });
        } catch (error) {
          if (
            !isCurrent() ||
            axios.isCancel(error) ||
            controller.signal.aborted
          )
            return;
          const { status, code } = errorDetails(error);
          if (status === 409 && code === "SHOPPING_LIST_STALE") {
            gotStale = true;
            staleRef.current = true;
            setStale(true);
            setConflictNotice(true);
            setErrors(() => ({}));
          } else {
            const action = status === 404 ? "reload" : "retry";
            const message =
              status === 404
                ? "Este producto ya no está disponible en el plan. Actualizá la lista."
                : "No se pudo guardar. Tu selección anterior sigue activa.";
            setErrors((current) => ({
              ...current,
              [itemKey]: { message, checked, action },
            }));
          }
        } finally {
          if (isCurrent()) {
            lockedItems.current.delete(itemKey);
            setPending((current) => {
              const next = { ...current };
              delete next[itemKey];
              return next;
            });
          }
          writes.current.delete(itemKey);
          if (gotStale && !reconciliation.current) {
            reconciliation.current = true;
            await Promise.allSettled([...writes.current.values()]);
            if (isCurrent()) void load();
          }
        }
      });
      writes.current.set(itemKey, operation);
    },
    [load, setErrors],
  );

  const retryItem = useCallback(
    (itemKey: string) => {
      const previous = errorRef.current[itemKey];
      if (previous?.action === "reload") {
        reload();
        return;
      }
      if (previous && !staleRef.current) sendCheck(itemKey, previous.checked);
    },
    [reload, sendCheck],
  );

  return {
    state,
    response,
    pending,
    itemErrors,
    stale,
    conflictNotice,
    reload: stale ? undefined : reload,
    setChecked: (key: string, checked: boolean) => sendCheck(key, checked),
    retryItem,
  };
}
