import { useCallback, useEffect, useRef, useState } from "react";
import { networkConfig } from "../config/network";

const POLL_MS = 10_000;

export interface WalletNetworkState {
  /** Human-readable label of the wallet's current network, e.g. "Testnet" */
  walletNetwork: string | null;
  /** True when the wallet is connected to a different network than the app expects */
  isMismatch: boolean;
  /** Human-readable label of the network the app expects */
  expectedNetwork: string;
  /** True while a manually-triggered recheck (via checkNow) is in flight */
  isChecking: boolean;
  /**
   * Re-reads the wallet's network immediately instead of waiting for the next
   * poll tick. Used by the guided fix flow so a user who just switched
   * networks in their wallet gets instant feedback instead of up to
   * POLL_MS of stale state.
   */
  checkNow: () => Promise<void>;
}

/**
 * Polls Freighter's getNetworkDetails and compares the wallet's network
 * passphrase against the app's configured networkPassphrase.
 */
export function useWalletNetwork(walletAddress: string | null): WalletNetworkState {
  const expectedNetwork = networkConfig.isTestnet ? "Testnet" : "Mainnet";
  const [walletNetwork, setWalletNetwork] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const activeRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const { getNetworkDetails } = await import("@stellar/freighter-api");
      if (typeof getNetworkDetails !== "function") return;
      const details = await getNetworkDetails();
      if (!activeRef.current || !details?.networkPassphrase) return;
      const isMainnet = details.networkPassphrase.toLowerCase().includes("public");
      setWalletNetwork(isMainnet ? "Mainnet" : "Testnet");
    } catch {
      // leave previous value; don't flash a false mismatch on transient errors
    }
  }, []);

  const checkNow = useCallback(async () => {
    if (!walletAddress) return;
    setIsChecking(true);
    try {
      await poll();
    } finally {
      if (activeRef.current) setIsChecking(false);
    }
  }, [poll, walletAddress]);

  useEffect(() => {
    activeRef.current = true;

    if (!walletAddress) {
      queueMicrotask(() => setWalletNetwork(null));
      return;
    }

    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);

    return () => {
      activeRef.current = false;
      window.clearInterval(id);
    };
  }, [walletAddress, poll]);

  const isMismatch =
    walletNetwork !== null && walletNetwork !== expectedNetwork;

  return { walletNetwork, isMismatch, expectedNetwork, isChecking, checkNow };
}
