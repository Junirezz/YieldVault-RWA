import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSelectedNetwork } from "./useSelectedNetwork";
import { networkConfig } from "../config/network";
import {
  readSelectedNetwork,
  SELECTED_NETWORK_STORAGE_KEY,
  SELECTED_NETWORK_STORAGE_VERSION,
} from "../config/selectedNetwork";

describe("useSelectedNetwork", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads the persisted selection on mount (survives a reload)", () => {
    localStorage.setItem(
      SELECTED_NETWORK_STORAGE_KEY,
      JSON.stringify({ version: SELECTED_NETWORK_STORAGE_VERSION, data: "mainnet" }),
    );

    const { result, unmount } = renderHook(() => useSelectedNetwork());
    expect(result.current.selectedNetwork).toBe("mainnet");
    expect(result.current.expectedNetwork).toBe("Mainnet");

    unmount();
    const { result: reloaded } = renderHook(() => useSelectedNetwork());
    expect(reloaded.current.selectedNetwork).toBe("mainnet");
  });

  it("shares the selection between hook instances and updates derived URLs", () => {
    const first = renderHook(() => useSelectedNetwork());
    const second = renderHook(() => useSelectedNetwork());

    act(() => {
      first.result.current.setSelectedNetwork("mainnet");
    });

    expect(second.result.current.selectedNetwork).toBe("mainnet");
    expect(second.result.current.activeConfig.rpcUrl).toBe(networkConfig.rpcUrl);
    expect(networkConfig.rpcUrl).toBe("https://soroban-mainnet.stellar.org");
    expect(networkConfig.explorerUrl).toBe("https://stellar.expert/explorer/public");
    expect(readSelectedNetwork()).toBe("mainnet");
  });
});
