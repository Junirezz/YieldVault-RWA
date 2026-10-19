/**
 * Issue #1625 acceptance criteria covered here:
 *  - Freighter `getAddress` errors (returned in-band) map to typed error codes
 *    and the matching i18n keys.
 *  - `wallet_session_start` is written through `lib/walletSession`.
 *  - Wallet polling backs off after consecutive failures.
 */
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWalletConnection, getWalletPollDelay } from "./useWalletConnection";
import * as freighter from "@stellar/freighter-api";
import * as stellarAccount from "../lib/stellarAccount";
import { ToastProvider } from "../context/ToastContext";
import {
  WALLET_SESSION_START_KEY,
  getWalletSessionStart,
} from "../lib/walletSession";
import { walletErrorI18nKeys } from "../lib/walletConnectionState";

vi.mock("@stellar/freighter-api", () => ({
  isConnected: vi.fn(),
  isAllowed: vi.fn(),
  setAllowed: vi.fn(),
  getAddress: vi.fn(),
}));

vi.mock("../lib/stellarAccount", () => ({
  discoverConnectedAddress: vi.fn(),
  discoverConnectedAddressWithRetry: vi.fn(),
}));

const mockedFreighter = vi.mocked(freighter);

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);

function renderWalletConnection(walletAddress: string | null = null) {
  const onConnect = vi.fn();
  const onDisconnect = vi.fn();

  const utils = renderHook(
    () => useWalletConnection({ walletAddress, onConnect, onDisconnect }),
    { wrapper: Wrapper },
  );

  return { ...utils, onConnect, onDisconnect };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mockedFreighter.isConnected.mockResolvedValue({ isConnected: true });
  mockedFreighter.isAllowed.mockResolvedValue({ isAllowed: true });
  mockedFreighter.setAllowed.mockResolvedValue({ isAllowed: true });
  mockedFreighter.getAddress.mockResolvedValue({ address: "GABC123" });
  vi.mocked(stellarAccount.discoverConnectedAddress).mockResolvedValue(null);
  vi.mocked(stellarAccount.discoverConnectedAddressWithRetry).mockResolvedValue(
    null,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("performConnect error mapping (issue #1625)", () => {
  it("maps an in-band Freighter getAddress error to a typed code + i18n keys", async () => {
    mockedFreighter.getAddress.mockResolvedValue({
      address: "",
      error: { code: 3, message: "User rejected the request." },
    });

    const { result, onConnect } = renderWalletConnection();

    await act(async () => {
      await result.current.handleConnect();
    });

    expect(onConnect).not.toHaveBeenCalled();
    expect(result.current.connection.status).toBe("error");
    expect(result.current.connection.error?.code).toBe("USER_REJECTED");
    expect(result.current.errorI18nKeys).toEqual(
      walletErrorI18nKeys("USER_REJECTED"),
    );
    expect(result.current.hasError).toBe(true);
  });

  it("classifies a Freighter permission error without dropping the payload", async () => {
    mockedFreighter.getAddress.mockResolvedValue({
      address: "",
      error: { code: 4, message: "Freighter permission denied." },
    });

    const { result } = renderWalletConnection();

    await act(async () => {
      await result.current.handleConnect();
    });

    expect(result.current.connection.error?.code).toBe("PERMISSION_DENIED");
    expect(result.current.connection.error?.message).toContain(
      "Freighter permission denied.",
    );
    expect(result.current.connection.error?.message).toContain("code 4");
  });

  it("falls back to NO_ADDRESS when Freighter returns no address and no error", async () => {
    mockedFreighter.getAddress.mockResolvedValue({ address: "" });

    const { result, onConnect } = renderWalletConnection();

    await act(async () => {
      await result.current.handleConnect();
    });

    expect(onConnect).not.toHaveBeenCalled();
    expect(result.current.connection.error?.code).toBe("NO_ADDRESS");
  });

  it("records the session start through lib/walletSession on success", async () => {
    const before = Date.now();

    const { result, onConnect } = renderWalletConnection();

    await act(async () => {
      await result.current.handleConnect();
    });

    expect(onConnect).toHaveBeenCalledWith("GABC123");

    const sessionStart = getWalletSessionStart();
    expect(sessionStart).not.toBeNull();
    expect(sessionStart as number).toBeGreaterThanOrEqual(before);
    expect(localStorage.getItem(WALLET_SESSION_START_KEY)).toBe(
      String(sessionStart),
    );
  });
});

describe("getWalletPollDelay (issue #1625)", () => {
  it("grows the delay with consecutive failures and caps it", () => {
    expect(getWalletPollDelay(0, 100, 1_600)).toBe(100);
    expect(getWalletPollDelay(1, 100, 1_600)).toBe(200);
    expect(getWalletPollDelay(2, 100, 1_600)).toBe(400);
    expect(getWalletPollDelay(3, 100, 1_600)).toBe(800);
    expect(getWalletPollDelay(4, 100, 1_600)).toBe(1_600);
    expect(getWalletPollDelay(99, 100, 1_600)).toBe(1_600);
  });
});

describe("wallet polling backoff (issue #1625)", () => {
  it("polls far less often once Freighter keeps failing", async () => {
    vi.useFakeTimers();
    mockedFreighter.isConnected.mockResolvedValue({ isConnected: false });

    renderWalletConnection();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    // Without backoff the fixed 100 ms test interval would poll ~15x in 1.5 s.
    const polls = mockedFreighter.isConnected.mock.calls.length;
    expect(polls).toBeGreaterThanOrEqual(3);
    expect(polls).toBeLessThanOrEqual(6);
  });
});
