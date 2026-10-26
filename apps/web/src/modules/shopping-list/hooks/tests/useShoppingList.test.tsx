import { act, renderHook, waitFor } from "@testing-library/react";
import { AxiosError } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useShoppingList } from "@/modules/shopping-list/hooks/useShoppingList";
import { shoppingListService } from "@/services/shoppingListService";
import { shoppingListFixture } from "@/modules/shopping-list/fixtures/shoppingList.fixture";

vi.mock("@/services/shoppingListService", () => ({
  shoppingListService: { getForWeek: vi.fn(), setItemChecked: vi.fn() },
}));

const identity = { id: "user-1" };
const key = shoppingListFixture.items[1].key;
const patchOptions = expect.objectContaining({
  signal: expect.any(AbortSignal),
  isRequestCurrent: expect.any(Function),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

afterEach(() => vi.clearAllMocks());

describe("useShoppingList mutations", () => {
  it("blocks a second update for the same item and confirms the boolean only after the API", async () => {
    const pendingPatch = deferred<{ itemKey: string; checked: boolean }>();
    vi.mocked(shoppingListService.getForWeek).mockResolvedValue(
      shoppingListFixture,
    );
    vi.mocked(shoppingListService.setItemChecked).mockReturnValue(
      pendingPatch.promise,
    );
    const { result } = renderHook(() =>
      useShoppingList("2026-10-19", identity, true),
    );
    await waitFor(() => expect(result.current.state).toBe("success"));

    act(() => {
      result.current.setChecked(key, true);
      result.current.setChecked(key, false);
    });
    await waitFor(() =>
      expect(shoppingListService.setItemChecked).toHaveBeenCalledTimes(1),
    );
    expect(
      result.current.response?.items.find((item) => item.key === key)?.checked,
    ).toBe(false);

    await act(async () => {
      pendingPatch.resolve({ itemKey: key, checked: true });
      await pendingPatch.promise;
    });
    await waitFor(() =>
      expect(
        result.current.response?.items.find((item) => item.key === key)
          ?.checked,
      ).toBe(true),
    );
  });

  it("preserves the prior value after a failure and retries the same absolute intent only on request", async () => {
    vi.mocked(shoppingListService.getForWeek).mockResolvedValue(
      shoppingListFixture,
    );
    vi.mocked(shoppingListService.setItemChecked)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ itemKey: key, checked: true });
    const { result } = renderHook(() =>
      useShoppingList("2026-10-19", identity, true),
    );
    await waitFor(() => expect(result.current.state).toBe("success"));

    act(() => result.current.setChecked(key, true));
    await waitFor(() =>
      expect(result.current.itemErrors[key]?.action).toBe("retry"),
    );
    expect(
      result.current.response?.items.find((item) => item.key === key)?.checked,
    ).toBe(false);
    expect(shoppingListService.setItemChecked).toHaveBeenCalledTimes(1);
    act(() => result.current.retryItem(key));
    await waitFor(() =>
      expect(
        result.current.response?.items.find((item) => item.key === key)
          ?.checked,
      ).toBe(true),
    );
    expect(shoppingListService.setItemChecked).toHaveBeenLastCalledWith(
      key,
      expect.objectContaining({ checked: true }),
      patchOptions,
    );
  });

  it("reconciles one stale-plan conflict and never replays the check on the new snapshot", async () => {
    const error = new AxiosError("stale");
    error.response = {
      status: 409,
      data: { code: "SHOPPING_LIST_STALE" },
      statusText: "Conflict",
      headers: {},
      config: {} as never,
    };
    vi.mocked(shoppingListService.getForWeek).mockResolvedValue(
      shoppingListFixture,
    );
    vi.mocked(shoppingListService.setItemChecked).mockRejectedValue(error);
    const { result } = renderHook(() =>
      useShoppingList("2026-10-19", identity, true),
    );
    await waitFor(() => expect(result.current.state).toBe("success"));

    act(() => result.current.setChecked(key, true));
    await waitFor(() =>
      expect(shoppingListService.getForWeek).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(result.current.conflictNotice).toBe(true));
    expect(result.current.stale).toBe(false);
    expect(shoppingListService.setItemChecked).toHaveBeenCalledTimes(1);
    expect(
      result.current.response?.items.find((item) => item.key === key)?.checked,
    ).toBe(false);
  });

  it("ignores a late response from a previous week and user session", async () => {
    const oldResponse = deferred<typeof shoppingListFixture>();
    const nextIdentity = { id: "user-2" };
    vi.mocked(shoppingListService.getForWeek).mockImplementation((weekStart) =>
      weekStart === "2026-10-19"
        ? oldResponse.promise
        : Promise.resolve({
            ...shoppingListFixture,
            weekStart,
            items: [],
            summary: { totalItems: 0, checkedItems: 0 },
          }),
    );
    const { result, rerender } = renderHook(
      ({ weekStart, user }: { weekStart: string; user: object }) =>
        useShoppingList(weekStart, user, true),
      { initialProps: { weekStart: "2026-10-19", user: identity } },
    );

    rerender({ weekStart: "2026-10-26", user: nextIdentity });
    await waitFor(() =>
      expect(result.current.response?.weekStart).toBe("2026-10-26"),
    );
    await act(async () => {
      oldResponse.resolve(shoppingListFixture);
      await oldResponse.promise;
    });
    expect(result.current.response?.weekStart).toBe("2026-10-26");
  });
});
