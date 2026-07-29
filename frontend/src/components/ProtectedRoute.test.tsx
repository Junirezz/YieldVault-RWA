import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";

function renderGuarded(role: "guest" | "investor" | "admin") {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route
          path="/admin"
          element={
            <ProtectedRoute role={role} allow={["admin"]}>
              <div data-testid="admin-page">Admin Page</div>
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<div data-testid="home-page">Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  it("renders the protected content when the role is allowed", () => {
    renderGuarded("admin");
    expect(screen.getByTestId("admin-page")).toBeInTheDocument();
  });

  it("redirects to the default path when the role is not allowed", () => {
    renderGuarded("investor");
    expect(screen.queryByTestId("admin-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("home-page")).toBeInTheDocument();
  });

  it("redirects guests away from the protected route", () => {
    renderGuarded("guest");
    expect(screen.queryByTestId("admin-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("home-page")).toBeInTheDocument();
  });

  it("redirects to a custom path when provided", () => {
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route
            path="/admin"
            element={
              <ProtectedRoute role="guest" allow={["admin"]} redirectTo="/portfolio">
                <div data-testid="admin-page">Admin Page</div>
              </ProtectedRoute>
            }
          />
          <Route path="/portfolio" element={<div data-testid="portfolio-page">Portfolio</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("portfolio-page")).toBeInTheDocument();
  });
});
