import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RouteErrorBoundary from "./RouteErrorBoundary";

const captureException = vi.fn();

vi.mock("../config/sentry", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("page crashed");
  }
  return <div>page content</div>;
}

describe("RouteErrorBoundary", () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  it("renders the page when it does not throw", () => {
    render(
      <RouteErrorBoundary routeName="home">
        <Boom shouldThrow={false} />
      </RouteErrorBoundary>,
    );

    expect(screen.getByText("page content")).toBeDefined();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("shows a user-friendly fallback and reports to Sentry when the page throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <RouteErrorBoundary routeName="home">
        <Boom shouldThrow />
      </RouteErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText("Something went wrong")).toBeDefined();
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(captureException.mock.calls[0][1]).toEqual({ route: "home" });

    spy.mockRestore();
  });

  it("recovers via the retry button after the underlying error is resolved", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let shouldThrow = true;

    const { rerender } = render(
      <RouteErrorBoundary routeName="home">
        <Boom shouldThrow={shouldThrow} />
      </RouteErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeDefined();

    shouldThrow = false;
    rerender(
      <RouteErrorBoundary routeName="home">
        <Boom shouldThrow={shouldThrow} />
      </RouteErrorBoundary>,
    );

    fireEvent.click(screen.getByText("Try Again"));

    expect(screen.getByText("page content")).toBeDefined();
    spy.mockRestore();
  });
});
