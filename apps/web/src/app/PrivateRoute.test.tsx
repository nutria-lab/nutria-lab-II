import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PrivateRoute } from "./PrivateRoute";

const AUTH_FLAG_KEY = "nutria:isAuthenticated";

function renderWithRoute(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login screen</div>} />
        <Route element={<PrivateRoute />}>
          <Route path="/protected" element={<div>Protected content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  localStorage.removeItem(AUTH_FLAG_KEY);
});

describe("PrivateRoute", () => {
  it("redirects to /login when there is no authenticated session", () => {
    renderWithRoute("/protected");

    expect(screen.getByText("Login screen")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("renders the protected content when the session flag is present", () => {
    localStorage.setItem(AUTH_FLAG_KEY, "true");

    renderWithRoute("/protected");

    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });
});
