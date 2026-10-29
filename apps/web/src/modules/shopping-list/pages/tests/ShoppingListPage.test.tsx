import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShoppingListPage } from "@/modules/shopping-list/pages/ShoppingListPage";
import {
  shoppingListFixture,
  secondWeekShoppingListFixture,
} from "@/modules/shopping-list/fixtures/shoppingList.fixture";
import { shoppingListService } from "@/services/shoppingListService";
import { getBuenosAiresWeekStart } from "@/modules/shopping-list/utils";

vi.mock("@/features/auth/AuthProvider", () => ({
  useAuth: (() => {
    const user = { id: "user-1" };
    return () => ({ status: "authenticated", user });
  })(),
}));
vi.mock("@/services/shoppingListService", () => ({
  shoppingListService: { getForWeek: vi.fn(), setItemChecked: vi.fn() },
}));

function renderPage(path = "/shopping-list?weekStart=2026-10-19") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ShoppingListPage />
    </MemoryRouter>,
  );
}

afterEach(() => vi.clearAllMocks());

describe("ShoppingListPage backend integration", () => {
  it("loads the selected week from the service and changes calendar weeks without carrying old items", async () => {
    vi.mocked(shoppingListService.getForWeek).mockImplementation(
      async (weekStart) =>
        weekStart === secondWeekShoppingListFixture.weekStart
          ? secondWeekShoppingListFixture
          : shoppingListFixture,
    );
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("checkbox", { name: /arroz, 250[,.]125 g/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Semana siguiente" }));
    expect(await screen.findByText(/Yogur natural/)).toBeInTheDocument();
    expect(screen.queryByText("Arroz")).not.toBeInTheDocument();
    expect(shoppingListService.getForWeek).toHaveBeenCalledWith(
      "2026-10-26",
      expect.anything(),
    );
  });

  it("keeps the confirmed checkbox until PATCH responds and sends an absolute value with the original plan token", async () => {
    vi.mocked(shoppingListService.getForWeek).mockResolvedValue(
      shoppingListFixture,
    );
    let resolvePatch!: (result: { itemKey: string; checked: boolean }) => void;
    vi.mocked(shoppingListService.setItemChecked).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );
    const user = userEvent.setup();
    renderPage();

    const rice = await screen.findByRole("checkbox", {
      name: /arroz, 250[,.]125 g/i,
    });
    await user.click(rice);
    expect(rice).not.toBeChecked();
    expect(shoppingListService.setItemChecked).toHaveBeenCalledWith(
      "fixture-key-arroz-g-19-oct",
      {
        planId: shoppingListFixture.plan?.id,
        planUpdatedAt: shoppingListFixture.plan?.updatedAt,
        checked: true,
      },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        isRequestCurrent: expect.any(Function),
      }),
    );

    resolvePatch({ itemKey: "fixture-key-arroz-g-19-oct", checked: true });
    await waitFor(() => expect(rice).toBeChecked());
    expect(screen.getByText("2 de 3 marcados")).toBeInTheDocument();
  });

  it("replaces an invalid week query with the current Buenos Aires Monday before loading", async () => {
    vi.mocked(shoppingListService.getForWeek).mockResolvedValue(
      shoppingListFixture,
    );
    renderPage("/shopping-list?weekStart=2026-10-20");
    await screen.findByRole("checkbox", { name: /arroz, 250[,.]125 g/i });
    expect(shoppingListService.getForWeek).toHaveBeenCalledWith(
      getBuenosAiresWeekStart(),
      expect.anything(),
    );
  });
});
