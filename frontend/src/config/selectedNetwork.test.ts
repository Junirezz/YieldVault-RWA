import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSelectedNetwork,
  isStellarNetwork,
  readSelectedNetwork,
  SELECTED_NETWORK_STORAGE_KEY,
  SELECTED_NETWORK_STORAGE_VERSION,
  setSelectedNetwork,
  subscribeSelectedNetwork,
} from "./selectedNetwork";

describe("selectedNetwork persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to the build network until a selection is stored", () => {
    expect(getSelectedNetwork("testnet")).toBe("testnet");
    expect(getSelectedNetwork("mainnet")).toBe("mainnet");
    expect(readSelectedNetwork()).toBeNull();
  });

  it("stores the selection in a versioned envelope that survives a reload", () => {
    setSelectedNetwork("mainnet");

    const raw = localStorage.getItem(SELECTED_NETWORK_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      version: SELECTED_NETWORK_STORAGE_VERSION,
      data: "mainnet",
    });

    // A fresh read simulates reloading the page.
    expect(readSelectedNetwork()).toBe("mainnet");
    expect(getSelectedNetwork("testnet")).toBe("mainnet");
  });

  it("migrates a legacy raw selection into the versioned envelope", () => {
    localStorage.setItem(SELECTED_NETWORK_STORAGE_KEY, "testnet");

    expect(readSelectedNetwork()).toBe("testnet");
    expect(JSON.parse(localStorage.getItem(SELECTED_NETWORK_STORAGE_KEY)!)).toEqual({
      version: SELECTED_NETWORK_STORAGE_VERSION,
      data: "testnet",
    });
  });

  it("ignores malformed, unsupported and future-version values", () => {
    localStorage.setItem(SELECTED_NETWORK_STORAGE_KEY, "not-a-network");
    expect(readSelectedNetwork()).toBeNull();

    localStorage.setItem(
      SELECTED_NETWORK_STORAGE_KEY,
      JSON.stringify({ version: SELECTED_NETWORK_STORAGE_VERSION + 1, data: "mainnet" }),
    );
    expect(readSelectedNetwork()).toBeNull();

    localStorage.setItem(
      SELECTED_NETWORK_STORAGE_KEY,
      JSON.stringify({ version: SELECTED_NETWORK_STORAGE_VERSION, data: "unknown" }),
    );
    expect(readSelectedNetwork()).toBeNull();
  });

  it("validates values before accepting them", () => {
    expect(isStellarNetwork("mainnet")).toBe(true);
    expect(isStellarNetwork("devnet")).toBe(false);
    setSelectedNetwork("devnet" as never);
    expect(readSelectedNetwork()).toBeNull();
  });

  it("notifies subscribers when the selection changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSelectedNetwork(listener);

    setSelectedNetwork("mainnet");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setSelectedNetwork("testnet");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
