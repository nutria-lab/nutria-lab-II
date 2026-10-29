import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

import { useAuth } from "../../../features/auth/AuthProvider";
import { ShoppingListView } from "../components/ShoppingListView";
import { useShoppingList } from "../hooks/useShoppingList";
import {
  getBuenosAiresWeekStart,
  isMondayDate,
  shiftWeekStart,
} from "../utils";

export function ShoppingListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { status, user } = useAuth();
  const requestedWeek = searchParams.get("weekStart");
  const weekStart =
    requestedWeek && isMondayDate(requestedWeek)
      ? requestedWeek
      : getBuenosAiresWeekStart();

  useEffect(() => {
    if (requestedWeek !== weekStart) {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("weekStart", weekStart);
          return next;
        },
        { replace: true },
      );
    }
  }, [requestedWeek, setSearchParams, weekStart]);

  const list = useShoppingList(weekStart, user, status === "authenticated");

  return (
    <ShoppingListView
      onChangeWeek={(next) => {
        if (isMondayDate(next)) {
          setSearchParams((current) => {
            const params = new URLSearchParams(current);
            params.set("weekStart", next);
            return params;
          });
        }
      }}
      onRetry={list.reload ?? (() => undefined)}
      onSetChecked={list.setChecked}
      onRetryItem={list.retryItem}
      pending={list.pending}
      itemErrors={list.itemErrors}
      stale={list.stale}
      conflictNotice={list.conflictNotice}
      response={list.response}
      state={list.state}
      weekStart={weekStart}
    />
  );
}
