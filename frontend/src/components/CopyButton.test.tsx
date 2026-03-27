import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CopyButton from "./CopyButton";
import { ToastProvider } from "../context/ToastContext";

function renderCopyButton() {
  return render(
    <ToastProvider>
      <CopyButton value="GABC1234567890" label="wallet address" />
    </ToastProvider>,
  );
}

describe("CopyButton", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies text with the Clipboard API and announces success", async () => {
    renderCopyButton();

    fireEvent.click(screen.getByRole("button", { name: /Copy wallet address/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("GABC1234567890");
    });

    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(screen.getByText("Wallet address copied")).toBeInTheDocument();
  });

  it("uses the legacy execCommand fallback when needed", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });

    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => true),
    });

    renderCopyButton();

    fireEvent.click(screen.getByRole("button", { name: /Copy wallet address/i }));

    await waitFor(() => {
      expect(document.execCommand).toHaveBeenCalledWith("copy");
    });

    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("shows failure feedback when copying is rejected", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });

    renderCopyButton();

    fireEvent.click(screen.getByRole("button", { name: /Copy wallet address/i }));

    expect(await screen.findByText("Copy failed")).toBeInTheDocument();
    expect(screen.getByText("Unable to copy wallet address")).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
  });
});
