import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearWalletSessionState, SESSION_STORAGE_KEYS, LOCAL_STORAGE_KEYS } from "./sessionCleanup";

describe("clearWalletSessionState", () => {
  const queryClient = {
    clear: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("clears react-query cache and removes known session keys", () => {
    localStorage.setItem("sessionToken", "token-1");
    localStorage.setItem("accessToken", "token-2");
    localStorage.setItem("wallet_session_start", "1234567890");
    localStorage.setItem("yieldvault.preferences", "{\"theme\":\"dark\"}");

    clearWalletSessionState(queryClient);

    expect(queryClient.clear).toHaveBeenCalledTimes(1);

    for (const key of SESSION_STORAGE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }

    for (const key of LOCAL_STORAGE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }

    // Non-session preference data should remain untouched.
    expect(localStorage.getItem("yieldvault.preferences")).toBe(
      "{\"theme\":\"dark\"}",
    );
  });
});
