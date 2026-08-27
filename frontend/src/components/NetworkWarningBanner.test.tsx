import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import NetworkWarningBanner from "./NetworkWarningBanner";
import * as useWalletNetworkModule from "../hooks/useWalletNetwork";

vi.mock("../hooks/useWalletNetwork");

const mockUseWalletNetwork = vi.mocked(useWalletNetworkModule.useWalletNetwork);

describe("NetworkWarningBanner", () => {
  const checkNowMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when there is no network mismatch", () => {
    mockUseWalletNetwork.mockReturnValue({
      walletNetwork: "Testnet",
      isMismatch: false,
      expectedNetwork: "Testnet",
      isChecking: false,
      checkNow: checkNowMock,
    });

    const { container } = render(<NetworkWarningBanner walletAddress="GABC123" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders warning banner when wallet network is mismatched", () => {
    mockUseWalletNetwork.mockReturnValue({
      walletNetwork: "Mainnet",
      isMismatch: true,
      expectedNetwork: "Testnet",
      isChecking: false,
      checkNow: checkNowMock,
    });

    render(<NetworkWarningBanner walletAddress="GABC123" />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(screen.getByText("Mainnet")).toBeInTheDocument();
    expect(screen.getByText("Testnet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show me how to fix this/i })).toBeInTheDocument();
  });

  it("opens the guided fix modal when clicking the fix button", () => {
    mockUseWalletNetwork.mockReturnValue({
      walletNetwork: "Mainnet",
      isMismatch: true,
      expectedNetwork: "Testnet",
      isChecking: false,
      checkNow: checkNowMock,
    });

    render(<NetworkWarningBanner walletAddress="GABC123" />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const fixButton = screen.getByRole("button", { name: /show me how to fix this/i });
    fireEvent.click(fixButton);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check again/i })).toBeInTheDocument();
  });

  it("triggers checkNow callback when requested in guide modal", () => {
    mockUseWalletNetwork.mockReturnValue({
      walletNetwork: "Mainnet",
      isMismatch: true,
      expectedNetwork: "Testnet",
      isChecking: false,
      checkNow: checkNowMock,
    });

    render(<NetworkWarningBanner walletAddress="GABC123" />);

    fireEvent.click(screen.getByRole("button", { name: /show me how to fix this/i }));
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));

    expect(checkNowMock).toHaveBeenCalledTimes(1);
  });
});
