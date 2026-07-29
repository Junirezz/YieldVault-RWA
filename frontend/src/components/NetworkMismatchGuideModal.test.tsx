import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import NetworkMismatchGuideModal from "./NetworkMismatchGuideModal";

function renderModal(overrides: Partial<React.ComponentProps<typeof NetworkMismatchGuideModal>> = {}) {
  const onClose = vi.fn();
  const onCheckNow = vi.fn();
  const utils = render(
    <NetworkMismatchGuideModal
      isOpen
      onClose={onClose}
      isMismatch
      isChecking={false}
      walletNetwork="Mainnet"
      expectedNetwork="Testnet"
      onCheckNow={onCheckNow}
      {...overrides}
    />,
  );
  return { ...utils, onClose, onCheckNow };
}

describe("NetworkMismatchGuideModal", () => {
  it("renders nothing when closed", () => {
    renderModal({ isOpen: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the guided steps and current/expected networks when open", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/switch your wallet's network/i)).toBeInTheDocument();
    expect(screen.getByText(/select testnet from the network list/i)).toBeInTheDocument();
  });

  it("calls onCheckNow when the check-again button is clicked", () => {
    const { onCheckNow } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));
    expect(onCheckNow).toHaveBeenCalledTimes(1);
  });

  it("shows a still-mismatched message after a check that doesn't resolve it", () => {
    const { rerender } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));

    // Simulate the check completing without resolving the mismatch.
    rerender(
      <NetworkMismatchGuideModal
        isOpen
        onClose={vi.fn()}
        isMismatch
        isChecking={false}
        walletNetwork="Mainnet"
        expectedNetwork="Testnet"
        onCheckNow={vi.fn()}
      />,
    );
    expect(screen.getByText(/still on mainnet/i)).toBeInTheDocument();
  });

  it("auto-closes once a check confirms the mismatch is resolved", async () => {
    const onClose = vi.fn();
    const { rerender } = renderModal({ onClose });
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));

    // Simulate the check completing and finding the mismatch resolved.
    rerender(
      <NetworkMismatchGuideModal
        isOpen
        onClose={onClose}
        isMismatch={false}
        isChecking={false}
        walletNetwork="Testnet"
        expectedNetwork="Testnet"
        onCheckNow={vi.fn()}
      />,
    );

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("does not auto-close on first render just because isMismatch is already false", () => {
    const onClose = vi.fn();
    renderModal({ onClose, isMismatch: false });
    expect(onClose).not.toHaveBeenCalled();
  });
});
