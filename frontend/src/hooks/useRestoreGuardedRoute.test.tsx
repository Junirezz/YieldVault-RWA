import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useRestoreGuardedRoute } from "./useRestoreGuardedRoute";
import { ProtectedRoute } from "../components/ProtectedRoute";
import type { UserRole } from "../lib/roles";

function Harness({ role }: { role: UserRole }) {
  useRestoreGuardedRoute(role);
  return null;
}

function TestApp({
  role,
  initialEntries,
}: {
  role: UserRole;
  initialEntries: Array<{ pathname: string; state?: unknown }>;
}) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <Harness role={role} />
      <Routes>
        <Route path="/" element={<div data-testid="home">Home</div>} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute role={role} allow={["admin"]}>
              <div data-testid="admin">Admin</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("useRestoreGuardedRoute", () => {
  it("does nothing when there is no stashed redirect-back path", () => {
    render(<TestApp role="guest" initialEntries={[{ pathname: "/" }]} />);
    expect(screen.getByTestId("home")).toBeInTheDocument();
  });

  it("restores the stashed path on mount when the current role already allows it", () => {
    render(
      <TestApp
        role="admin"
        initialEntries={[{ pathname: "/", state: { from: "/admin" } }]}
      />,
    );
    expect(screen.getByTestId("admin")).toBeInTheDocument();
  });

  it("stays put (no crash or loop) when the current role still doesn't allow the stashed path", () => {
    render(
      <TestApp
        role="investor"
        initialEntries={[{ pathname: "/", state: { from: "/admin" } }]}
      />,
    );
    expect(screen.queryByTestId("admin")).not.toBeInTheDocument();
    expect(screen.getByTestId("home")).toBeInTheDocument();
  });

  it("restores the stashed path once the role changes to one that allows it", () => {
    const { rerender } = render(
      <TestApp
        role="investor"
        initialEntries={[{ pathname: "/", state: { from: "/admin" } }]}
      />,
    );
    expect(screen.getByTestId("home")).toBeInTheDocument();

    rerender(
      <TestApp
        role="admin"
        initialEntries={[{ pathname: "/", state: { from: "/admin" } }]}
      />,
    );
    expect(screen.getByTestId("admin")).toBeInTheDocument();
  });
});
