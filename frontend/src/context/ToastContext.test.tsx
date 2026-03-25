import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ToastProvider, useToast } from "./ToastContext";

function ToastHarness() {
  const toast = useToast();

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          toast.success({
            title: "Saved",
            description: "Changes were stored successfully.",
            duration: 1500,
          })
        }
      >
        Show success
      </button>
      <button
        type="button"
        onClick={() =>
          toast.error({
            title: "Failed",
            description: "Something went wrong.",
            duration: 1500,
          })
        }
      >
        Show error
      </button>
    </div>
  );
}

describe("ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows and auto-dismisses toasts", () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText(/Show success/i));

    expect(screen.getByRole("status")).toHaveTextContent("Saved");

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("supports manual dismissal", () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText(/Show error/i));
    fireEvent.click(screen.getByRole("button", { name: /Dismiss Failed/i }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
