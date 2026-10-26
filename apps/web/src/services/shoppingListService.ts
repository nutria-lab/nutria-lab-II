import { apiClient } from "./apiClient";
import type {
  ShoppingListCheckRequest,
  ShoppingListCheckResponse,
  ShoppingListResponse,
} from "../modules/shopping-list/types";

export type ShoppingListRequestOptions = {
  signal: AbortSignal;
  isRequestCurrent: () => boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isShoppingListResponse(
  value: unknown,
): value is ShoppingListResponse {
  if (
    !isRecord(value) ||
    typeof value.weekStart !== "string" ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.warnings) ||
    !isRecord(value.summary)
  )
    return false;
  if (
    value.plan !== null &&
    (!isRecord(value.plan) ||
      typeof value.plan.id !== "string" ||
      typeof value.plan.updatedAt !== "string" ||
      typeof value.plan.version !== "number")
  )
    return false;
  return (
    value.items.every(
      (item) =>
        isRecord(item) &&
        typeof item.key === "string" &&
        typeof item.name === "string" &&
        typeof item.checked === "boolean" &&
        ((typeof item.quantity === "number" &&
          Number.isFinite(item.quantity)) ||
          item.quantity === null) &&
        (typeof item.unit === "string" || item.unit === null) &&
        Array.isArray(item.sources) &&
        item.sources.every(
          (source) =>
            isRecord(source) &&
            typeof source.plannedMealId === "string" &&
            typeof source.recipeId === "string" &&
            Number.isInteger(source.ingredientIndex) &&
            ((typeof source.quantity === "number" &&
              Number.isFinite(source.quantity)) ||
              source.quantity === null) &&
            (typeof source.unit === "string" || source.unit === null),
        ),
    ) &&
    value.warnings.every(
      (warning) =>
        isRecord(warning) &&
        (warning.code === "MISSING_RECIPE" ||
          warning.code === "INVALID_INGREDIENT") &&
        typeof warning.plannedMealId === "string" &&
        (warning.ingredientIndex === undefined ||
          Number.isInteger(warning.ingredientIndex)),
    ) &&
    typeof value.summary.totalItems === "number" &&
    typeof value.summary.checkedItems === "number" &&
    value.summary.totalItems === value.items.length &&
    value.summary.checkedItems ===
      value.items.filter((item) => isRecord(item) && item.checked === true)
        .length
  );
}

export const shoppingListService = {
  async getForWeek(
    weekStart: string,
    options: ShoppingListRequestOptions,
  ): Promise<ShoppingListResponse> {
    const { data } = await apiClient.get<unknown>("/shopping-list", {
      params: { weekStart },
      signal: options.signal,
      timeout: 10_000,
      isRequestCurrent: options.isRequestCurrent,
    });
    if (!isShoppingListResponse(data) || data.weekStart !== weekStart) {
      throw new Error("La respuesta de la lista de compras no es válida.");
    }
    return data;
  },

  async setItemChecked(
    itemKey: string,
    input: ShoppingListCheckRequest,
    options: ShoppingListRequestOptions,
  ): Promise<ShoppingListCheckResponse> {
    const { data } = await apiClient.patch<unknown>(
      `/shopping-list/items/${encodeURIComponent(itemKey)}`,
      input,
      {
        signal: options.signal,
        timeout: 45_000,
        isRequestCurrent: options.isRequestCurrent,
      },
    );
    if (
      !isRecord(data) ||
      data.itemKey !== itemKey ||
      data.checked !== input.checked
    ) {
      throw new Error("La confirmación del producto no es válida.");
    }
    return data as ShoppingListCheckResponse;
  },
};
