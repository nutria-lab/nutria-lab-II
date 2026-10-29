import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ShoppingListPage } from "@/modules/shopping-list/pages/ShoppingListPage";
import { shoppingListFixture } from "@/modules/shopping-list/fixtures/shoppingList.fixture";

function renderPage() {
  return render(
    <MemoryRouter>
      <ShoppingListPage />
    </MemoryRouter>,
  );
}

describe("ShoppingListPage fixture container", () => {
  it("switches to the next calendar week without carrying over the previous items", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Semana siguiente" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /26 de octubre de 2026/i,
    );
    expect(await screen.findByText("Zanahoria")).toBeInTheDocument();
    expect(screen.queryByText("Arroz")).not.toBeInTheDocument();
  });

  it("sets a checkbox from its requested value, recalculates progress and leaves source fixtures unchanged", async () => {
    const user = userEvent.setup();
    renderPage();

    const rice = screen.getByRole("checkbox", { name: /arroz, 250[,.]125 g/i });
    await user.click(rice);

    expect(rice).toBeChecked();
    expect(screen.getByText("2 de 3 marcados")).toBeInTheDocument();
    expect(shoppingListFixture.items[1].checked).toBe(false);
  });
});
