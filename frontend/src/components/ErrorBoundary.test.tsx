import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("TypeError: boom");
  }
  return <div>ok</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <div>healthy</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("healthy")).toBeDefined();
  });

  it("shows user-safe fallback when a child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText("Something went wrong")).toBeDefined();
    expect(screen.queryByText(/TypeError: boom/)).toBeNull();

    spy.mockRestore();
  });

  it("recovers when Try Again is clicked after the child stops throwing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let shouldThrow = true;

    const { rerender } = render(
      <ErrorBoundary>
        <Boom shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeDefined();

    shouldThrow = false;
    rerender(
      <ErrorBoundary>
        <Boom shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    );
    // Boundary still holds error state until reset
    expect(screen.getByRole("alert")).toBeDefined();
    fireEvent.click(screen.getByText("Try Again"));

    expect(screen.getByText("ok")).toBeDefined();
    spy.mockRestore();
  });

  it("invokes onError when a child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    spy.mockRestore();
  });

  it("normalizes non-Error thrown values before reporting them", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <ThrowString />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe("string boom");
    spy.mockRestore();
  });
});

function ThrowString() {
  throw "string boom";
}
