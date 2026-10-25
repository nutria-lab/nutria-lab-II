import { useCallback, useEffect, useRef, useState } from "react";
import {
  shoppingListFixturesByWeek,
  noPlanShoppingListFixture,
} from "../fixtures/shoppingList.fixture";
import type { ShoppingListResponse } from "../types";
import { isMondayDate } from "../utils";
import {
  ShoppingListView,
  type ShoppingListViewState,
} from "../components/ShoppingListView";

const INITIAL_WEEK = "2026-10-19";
const FALLBACK_RESPONSE = noPlanShoppingListFixture;

export function ShoppingListPage() {
  const [weekStart, setWeekStart] = useState(INITIAL_WEEK);
  const [state, setState] = useState<ShoppingListViewState>("success");
  const [response, setResponse] = useState<ShoppingListResponse>(
    shoppingListFixturesByWeek[INITIAL_WEEK],
  );
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const changeWeek = useCallback((nextWeekStart: string) => {
    if (!isMondayDate(nextWeekStart)) return;
    window.clearTimeout(timer.current);
    setWeekStart(nextWeekStart);
    setState("loading");
    timer.current = window.setTimeout(() => {
      const fixture = shoppingListFixturesByWeek[nextWeekStart] ?? {
        ...FALLBACK_RESPONSE,
        weekStart: nextWeekStart,
      };
      setResponse(fixture);
      setState("success");
    }, 120);
  }, []);

  const retry = useCallback(() => {
    setState("loading");
    timer.current = window.setTimeout(() => {
      const fixture = shoppingListFixturesByWeek[weekStart] ?? {
        ...FALLBACK_RESPONSE,
        weekStart,
      };
      setResponse(fixture);
      setState("success");
    }, 120);
  }, [weekStart]);

  const setChecked = useCallback((key: string, checked: boolean) => {
    setResponse((current) => {
      const items = current.items.map((item) =>
        item.key === key ? { ...item, checked } : item,
      );
      return {
        ...current,
        items,
        summary: {
          totalItems: items.length,
          checkedItems: items.filter((item) => item.checked).length,
        },
      };
    });
  }, []);

  return (
    <ShoppingListView
      onChangeWeek={changeWeek}
      onRetry={retry}
      onSetChecked={setChecked}
      response={state === "loading" ? undefined : response}
      state={state}
      weekStart={weekStart}
    />
  );
}
