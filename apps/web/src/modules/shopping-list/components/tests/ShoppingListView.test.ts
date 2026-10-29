import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { ShoppingListResponse } from "@/modules/shopping-list/types";
import { ShoppingListView } from "@/modules/shopping-list/components/ShoppingListView";
import { checkedPartialShoppingListFixture } from "@/modules/shopping-list/fixtures/shoppingList.fixture";

const weekStart = "2026-10-19";

const noPlan: ShoppingListResponse = {
  weekStart,
  plan: null,
  items: [],
  summary: { totalItems: 0, checkedItems: 0 },
  warnings: [],
};

const emptyPlan: ShoppingListResponse = {
  ...noPlan,
  plan: { id: "plan-empty", version: 1, updatedAt: "2026-10-19T12:00:00.000Z" },
};

const partialList: ShoppingListResponse = {
  ...noPlan,
  plan: {
    id: "plan-current",
    version: 3,
    updatedAt: "2026-10-20T12:00:00.000Z",
  },
  items: [
    {
      key: "opaque-tomato-key",
      name: "Tomate",
      quantity: null,
      unit: null,
      checked: true,
      sources: [
        {
          plannedMealId: "meal-1",
          recipeId: "recipe-1",
          ingredientIndex: 0,
          quantity: null,
          unit: null,
        },
      ],
    },
    {
      key: "opaque-onion-key",
      name: "Cebolla",
      quantity: 1.125,
      unit: "kg",
      checked: false,
      sources: [
        {
          plannedMealId: "meal-2",
          recipeId: "recipe-2",
          ingredientIndex: 1,
          quantity: 1.125,
          unit: "kg",
        },
      ],
    },
  ],
  summary: { totalItems: 2, checkedItems: 1 },
  warnings: [
    { code: "MISSING_RECIPE", plannedMealId: "meal-3" },
    { code: "INVALID_INGREDIENT", plannedMealId: "meal-2", ingredientIndex: 2 },
  ],
};

function renderView(overrides: Record<string, unknown> = {}) {
  const props = {
    state: "success",
    weekStart,
    response: partialList,
    onRetry: vi.fn(),
    onSetChecked: vi.fn(),
    ...overrides,
  };

  return render(
    createElement(
      MemoryRouter,
      null,
      createElement(ShoppingListView, props as never),
    ),
  );
}

describe("ShoppingListView, Contract C fixtures", () => {
  it("keeps loading distinct from a successful empty response and announces it", () => {
    renderView({ state: "loading", response: undefined });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toMatch(/cargando/i);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("distinguishes no plan from a plan with no ingredients", () => {
    const { rerender } = renderView({ response: noPlan });
    const plannerLink = screen.getByRole("link", { name: /plan/i });
    expect(plannerLink.getAttribute("href")).toBe("/meal-plan");
    expect(screen.queryByText(/lista completa/i)).not.toBeInTheDocument();

    rerender(
      createElement(
        MemoryRouter,
        null,
        createElement(ShoppingListView, {
          state: "success",
          weekStart,
          response: emptyPlan,
          onRetry: vi.fn(),
          onSetChecked: vi.fn(),
        } as never),
      ),
    );

    expect(
      screen.queryByRole("link", { name: /plan/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/sin ingredientes/i)).toBeInTheDocument();
  });

  it("shows partial-data warnings and unknown quantity while preserving server item order", () => {
    renderView({ response: partialList });

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].getAttribute("aria-label")).toMatch(/tomate/i);
    expect(checkboxes[1].getAttribute("aria-label")).toMatch(/cebolla/i);
    expect(screen.getByText(/cantidad no disponible/i)).toBeInTheDocument();
    expect(screen.getByText(/1[,.]125\s*kg/i)).toBeInTheDocument();
    expect(screen.getByText(/receta/i)).toBeInTheDocument();
    expect(screen.getByText(/ingrediente/i)).toBeInTheDocument();
    expect(screen.getByText(/1 de 2/i)).toBeInTheDocument();
  });

  it("keeps warnings visible when no products are available and never calls that list complete", () => {
    const warningOnly: ShoppingListResponse = {
      ...emptyPlan,
      warnings: [{ code: "MISSING_RECIPE", plannedMealId: "opaque-meal-id" }],
    };
    renderView({ response: warningOnly });

    expect(screen.getByText(/0 de 0 marcados/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /lista puede estar incompleta/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/lista completa/i)).not.toBeInTheDocument();
    expect(screen.queryByText("opaque-meal-id")).not.toBeInTheDocument();
  });

  it("keeps partial warnings visible even when every available item is checked", () => {
    renderView({ response: checkedPartialShoppingListFixture });

    expect(screen.getByText(/2 de 2 marcados/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /lista puede estar incompleta/i }),
    ).toBeInTheDocument();
  });

  it("sends the stable item key and requested boolean when checking with the keyboard", async () => {
    const user = userEvent.setup();
    const onSetChecked = vi.fn();
    renderView({ onSetChecked });

    const checkbox = screen.getByRole("checkbox", { name: /cebolla/i });
    checkbox.focus();
    await user.keyboard(" ");

    expect(onSetChecked).toHaveBeenCalledWith("opaque-onion-key", true);
    expect(checkbox).toHaveFocus();
  });

  it("provides retry for an error state and a login destination for an expired session", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderView({ state: "error", response: undefined, onRetry });

    await user.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    renderView({ state: "session-expired", response: undefined });
    expect(
      screen
        .getByRole("link", { name: /iniciar sesi[oó]n/i })
        .getAttribute("href"),
    ).toBe("/login");
  });
});
