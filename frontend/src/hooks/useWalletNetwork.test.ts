import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWalletNetwork } from "./useWalletNetwork";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

const getNetworkDetails = vi.fn();

vi.mock("@stellar/freighter-api", () => ({
  getNetworkDetails: (...args: unknown[]) => getNetworkDetails(...args),
}));

describe("useWalletNetwork", () => {
  beforeEach(() => {
    getNetworkDetails.mockReset();
  });

  it("reports no wallet network and no mismatch when no wallet is connected", () => {
    const { result } = renderHook(() => useWalletNetwork(null));
    expect(result.current.walletNetwork).toBeNull();
    expect(result.current.isMismatch).toBe(false);
    expect(result.current.expectedNetwork).toBe("Testnet");
  });

  it("does not flag a mismatch when the wallet is on the expected (testnet) network", async () => {
    getNetworkDetails.mockResolvedValue({ networkPassphrase: TESTNET_PASSPHRASE });
    const { result } = renderHook(() => useWalletNetwork("GABC123"));
    await waitFor(() => expect(result.current.walletNetwork).toBe("Testnet"));
    expect(result.current.isMismatch).toBe(false);
  });

  it("flags a mismatch when the wallet is on mainnet but the app expects testnet", async () => {
    getNetworkDetails.mockResolvedValue({ networkPassphrase: MAINNET_PASSPHRASE });
    const { result } = renderHook(() => useWalletNetwork("GABC123"));
    await waitFor(() => expect(result.current.walletNetwork).toBe("Mainnet"));
    expect(result.current.isMismatch).toBe(true);
    expect(result.current.expectedNetwork).toBe("Testnet");
  });

  it("checkNow re-reads the network immediately, without waiting for the poll interval", async () => {
    getNetworkDetails.mockResolvedValue({ networkPassphrase: TESTNET_PASSPHRASE });
    const { result } = renderHook(() => useWalletNetwork("GABC123"));
    await waitFor(() => expect(result.current.walletNetwork).toBe("Testnet"));

    getNetworkDetails.mockResolvedValueOnce({ networkPassphrase: MAINNET_PASSPHRASE });
    await act(async () => {
      await result.current.checkNow();
    });

    expect(result.current.walletNetwork).toBe("Mainnet");
    expect(result.current.isMismatch).toBe(true);
  });

  it("exposes isChecking while a manual recheck triggered by checkNow is in flight", async () => {
    getNetworkDetails.mockResolvedValue({ networkPassphrase: TESTNET_PASSPHRASE });
    const { result } = renderHook(() => useWalletNetwork("GABC123"));
    await waitFor(() => expect(result.current.walletNetwork).toBe("Testnet"));

    let resolveDetails: (value: { networkPassphrase: string }) => void = () => {};
    getNetworkDetails.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDetails = resolve;
        }),
    );

    let checkPromise!: Promise<void>;
    act(() => {
      checkPromise = result.current.checkNow();
    });
    await waitFor(() => expect(result.current.isChecking).toBe(true));

    resolveDetails({ networkPassphrase: MAINNET_PASSPHRASE });
    await act(async () => {
      await checkPromise;
    });

    expect(result.current.isChecking).toBe(false);
    expect(result.current.walletNetwork).toBe("Mainnet");
  });

  it("does not attempt a recheck when no wallet is connected", async () => {
    const { result } = renderHook(() => useWalletNetwork(null));
    await act(async () => {
      await result.current.checkNow();
    });
    expect(getNetworkDetails).not.toHaveBeenCalled();
  });
});
