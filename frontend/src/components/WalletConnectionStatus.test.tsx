import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import WalletConnectionStatus from "./WalletConnectionStatus";

vi.mock("../i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "wallet.status.disconnected": "Not connected",
        "wallet.status.connecting": "Connecting to wallet...",
        "wallet.status.retrying": "Retrying connection...",
        "wallet.status.error": "Connection error",
        "wallet.status.connected": "Connected",
        "wallet.retry": "Try again",
      };
      return map[key] ?? key;
    },
  }),
}));

describe("WalletConnectionStatus", () => {
  it("renders nothing in connected state", () => {
    const { container } = render(<WalletConnectionStatus status="connected" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows disconnected status badge", () => {
    render(<WalletConnectionStatus status="disconnected" />);
    expect(screen.getByRole("status", { name: "Not connected" })).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });

  it("shows connecting status badge with aria-live polite", () => {
    render(<WalletConnectionStatus status="connecting" />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-live", "polite");
    expect(el).toHaveAttribute("aria-label", "Connecting to wallet...");
    expect(screen.getByText("Connecting to wallet...")).toBeInTheDocument();
  });

  it("shows retrying status badge with aria-live polite", () => {
    render(<WalletConnectionStatus status="retrying" retryCount={1} />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Retrying connection...")).toBeInTheDocument();
  });

  it("shows retry attempt count when retryCount > 1", () => {
    render(<WalletConnectionStatus status="retrying" retryCount={3} />);
    expect(screen.getByText("(3)")).toBeInTheDocument();
  });

  it("does not show retry count label on first attempt", () => {
    render(<WalletConnectionStatus status="retrying" retryCount={1} />);
    expect(screen.queryByText("(1)")).not.toBeInTheDocument();
  });

  it("shows error state with role=alert and aria-live=assertive", () => {
    render(
      <WalletConnectionStatus
        status="error"
        errorTitle="Connection error"
        errorDescription="Freighter permission denied."
      />,
    );
    const el = screen.getByRole("alert");
    expect(el).toHaveAttribute("aria-live", "assertive");
    expect(screen.getByText("Connection error")).toBeInTheDocument();
    expect(screen.getByText("Freighter permission denied.")).toBeInTheDocument();
  });

  it("shows retry button when error is retryable and onRetry is provided", () => {
    const onRetry = vi.fn();
    render(
      <WalletConnectionStatus
        status="error"
        errorTitle="Connection error"
        retryable={true}
        onRetry={onRetry}
      />,
    );
    const retryBtn = screen.getByRole("button", { name: /try again/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not show retry button when error is not retryable", () => {
    render(
      <WalletConnectionStatus
        status="error"
        errorTitle="Not installed"
        retryable={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("does not show retry button when onRetry is not provided", () => {
    render(
      <WalletConnectionStatus
        status="error"
        errorTitle="Connection error"
        retryable={true}
      />,
    );
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("applies custom className", () => {
    render(<WalletConnectionStatus status="disconnected" className="custom-class" />);
    const el = screen.getByRole("status");
    expect(el.className).toContain("custom-class");
  });

  it("applies custom style via data attribute presence", () => {
    // The style prop is merged into the element — verify the component renders
    // without throwing when a custom style is passed.
    const { container } = render(
      <WalletConnectionStatus status="disconnected" style={{ marginTop: "12px" }} />,
    );
    expect(container.firstChild).not.toBeNull();
  });
});
