import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { afterEach, describe, expect, it } from "vitest";

import { apiClient } from "@/services/apiClient";
import { shoppingListService } from "@/services/shoppingListService";
import { shoppingListFixture } from "@/modules/shopping-list/fixtures/shoppingList.fixture";

const initialAdapter = apiClient.defaults.adapter;
const options = {
  signal: new AbortController().signal,
  isRequestCurrent: () => true,
};

afterEach(() => {
  apiClient.defaults.adapter = initialAdapter;
});

function adapterFor(
  data: unknown,
  status = 200,
  seen?: (config: InternalAxiosRequestConfig) => void,
) {
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    seen?.(config);
    return { data, status, statusText: "OK", headers: {}, config };
  };
}

describe("shoppingListService", () => {
  it("requests the selected week with credentials and validates Contract C", async () => {
    let request!: InternalAxiosRequestConfig;
    apiClient.defaults.adapter = adapterFor(
      shoppingListFixture,
      200,
      (config) => {
        request = config;
      },
    );

    await expect(
      shoppingListService.getForWeek("2026-10-19", options),
    ).resolves.toEqual(shoppingListFixture);
    expect(request.url).toBe("/shopping-list");
    expect(request.params).toEqual({ weekStart: "2026-10-19" });
    expect(request.withCredentials).toBe(true);
    expect(request.timeout).toBe(10_000);
    expect(request.signal).toBe(options.signal);
    expect(request.isRequestCurrent).toBe(options.isRequestCurrent);
  });

  it("sends an absolute PATCH value and the exact plan token without adding userId", async () => {
    let request!: InternalAxiosRequestConfig;
    apiClient.defaults.adapter = adapterFor(
      { itemKey: "opaque-key", checked: true },
      200,
      (config) => {
        request = config;
      },
    );
    const payload = {
      planId: "plan-id",
      planUpdatedAt: "2026-10-20T12:00:00.001Z",
      checked: true,
    };

    await expect(
      shoppingListService.setItemChecked("opaque-key", payload, options),
    ).resolves.toEqual({ itemKey: "opaque-key", checked: true });
    expect(request.url).toBe("/shopping-list/items/opaque-key");
    expect(request.data).toBe(JSON.stringify(payload));
    expect(request.timeout).toBe(45_000);
    expect(request.data).not.toContain("userId");
  });

  it("rejects malformed successful responses instead of treating them as an empty list", async () => {
    apiClient.defaults.adapter = adapterFor({
      weekStart: "2026-10-19",
      plan: null,
      items: [],
      summary: {},
      warnings: [],
    });
    await expect(
      shoppingListService.getForWeek("2026-10-19", options),
    ).rejects.toThrow(/respuesta.*no es válida/i);
  });
});
