/**
 * NetworkBannerStack — priority / dedup / single-alert-policy tests.
 *
 * Strategy: mock every hook the stack depends on so we can control each
 * network condition independently, then assert that:
 *   • only one banner is rendered at a time
 *   • the correct priority wins when multiple conditions are active
 *   • role="alert" is used only for critical banners
 *   • informational banners use role="status"
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { NetworkBannerStack } from "../components/NetworkBannerStack";

// ─── Mock all hooks ───────────────────────────────────────────────────────────

vi.mock("../hooks/useNetworkStatus", () => ({
  useNetworkStatus: vi.fn(),
}));
vi.mock("../hooks/useNetworkQuality", () => ({
  useNetworkQuality: vi.fn(),
}));
vi.mock("../hooks/useWalletNetwork", () => ({
  useWalletNetwork: vi.fn(),
}));
vi.mock("../hooks/useRetryState", () => ({
  useRetryState: vi.fn(),
}));
vi.mock("../lib/queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));
// NetworkMismatchGuideModal is a heavy component — stub it out
vi.mock("../components/NetworkMismatchGuideModal", () => ({
  default: () => null,
}));
// i18n returns the key as-is for simplicity
vi.mock("../i18n", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { useNetworkQuality } from "../hooks/useNetworkQuality";
import { useWalletNetwork } from "../hooks/useWalletNetwork";
import { useRetryState } from "../hooks/useRetryState";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WALLET = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** Default "everything is fine" hook return values. */
function setAllGreen() {
  vi.mocked(useNetworkStatus).mockReturnValue({
    isOnline: true,
    isSlowConnection: false,
    effectiveType: undefined,
    downlink: undefined,
    saveData: false,
  });
  vi.mocked(useNetworkQuality).mockReturnValue({
    quality: "normal",
    latencyMs: 120,
    jitterMs: 5,
    sampleCount: 3,
    refetch: vi.fn(),
  });
  vi.mocked(useWalletNetwork).mockReturnValue({
    isMismatch: false,
    walletNetwork: "Testnet",
    expectedNetwork: "Testnet",
    isChecking: false,
    checkNow: vi.fn(),
  });
  vi.mocked(useRetryState).mockReturnValue({
    isRetrying: false,
    secondsUntilRetry: null,
  });
}

function renderStack(walletAddress: string | null = null) {
  return render(
    <NetworkBannerStack
      walletAddress={walletAddress}
      lastKnownTvl={5_000_000}
      lastKnownBalance={1250.5}
    />,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("NetworkBannerStack", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setAllGreen();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── No-banner base case ─────────────────────────────────────────────────

  it("renders nothing when all conditions are healthy", () => {
    const { container } = renderStack();
    expect(container.firstChild).toBeNull();
  });

  // ── Offline (priority 1) ────────────────────────────────────────────────

  it("shows offline alert when device is offline", () => {
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOnline: false,
      isSlowConnection: false,
      effectiveType: undefined,
      downlink: undefined,
      saveData: false,
    });

    renderStack();

    const alert = screen.getByRole("alert");
    expect(alert).toBeTruthy();
    expect(alert.getAttribute("aria-live")).toBe("assertive");
  });

  it("offline banner shows last-known TVL and balance", () => {
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOnline: false,
      isSlowConnection: false,
      effectiveType: undefined,
      downlink: undefined,
      saveData: false,
    });

    renderStack(WALLET);

    expect(screen.getByText(/TVL/i)).toBeTruthy();
    expect(screen.getByText(/1,250/)).toBeTruthy();
  });

  it("offline banner is non-dismissible (no dismiss button)", () => {
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOnline: false,
      isSlowConnection: false,
      effectiveType: undefined,
      downlink: undefined,
      saveData: false,
    });

    renderStack();

    const alert = screen.getByRole("alert");
    expect(alert.querySelector("button")).toBeNull();
  });

  // ── Offline suppresses lower-priority banners ───────────────────────────

  it("offline banner takes priority over network mismatch", () => {
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOnline: false,
      isSlowConnection: false,
      effectiveType: undefined,
      downlink: undefined,
      saveData: false,
    });
    vi.mocked(useWalletNetwork).mockReturnValue({
      isMismatch: true,
      walletNetwork: "Mainnet",
      expectedNetwork: "Testnet",
      isChecking: false,
      checkNow: vi.fn(),
    });

    renderStack(WALLET);

    // Only one alert — the offline one
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    // Network mismatch text should NOT appear
    expect(screen.queryByText(/networkWarning.wrongNetwork/)).toBeNull();
  });

  it("offline banner takes priority over high latency", () => {
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOnline: false,
      isSlowConnection: false,
      effectiveType: undefined,
      downlink: undefined,
      saveData: false,
    });
    vi.mocked(useNetworkQuality).mockReturnValue({
      quality: "degraded",
      latencyMs: 3000,
      jitterMs: 500,
      sampleCount: 5,
      refetch: vi.fn(),
    });

    renderStack();

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  // ── Network mismatch (priority 2) ───────────────────────────────────────

  it("shows network mismatch alert when online and wallet is on wrong network", () => {
    vi.mocked(useWalletNetwork).mockReturnValue({
      isMismatch: true,
      walletNetwork: "Mainnet",
      expectedNetwork: "Testnet",
      isChecking: false,
      checkNow: vi.fn(),
    });

    renderStack(WALLET);

    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(screen.getByText(/networkWarning.wrongNetwork/)).toBeTruthy();
  });

  it("network mismatch takes priority over high latency", () => {
    vi.mocked(useWalletNetwork).mockReturnValue({
      isMismatch: true,
      walletNetwork: "Mainnet",
      expectedNetwork: "Testnet",
      isChecking: false,
      checkNow: vi.fn(),
    });
    vi.mocked(useNetworkQuality).mockReturnValue({
      quality: "degraded",
      latencyMs: 3000,
      jitterMs: 500,
      sampleCount: 5,
      refetch: vi.fn(),
    });

    renderStack(WALLET);

    // Exactly one alert, no status
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  // ── High latency (priority 3) ───────────────────────────────────────────

  it("shows high-latency status banner for degraded quality", () => {
    vi.mocked(useNetworkQuality).mockReturnValue({
      quality: "degraded",
      latencyMs: 2500,
      jitterMs: 400,
      sampleCount: 5,
      refetch: vi.fn(),
    });

    renderStack();

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Degraded network/i)).toBeTruthy();
  });

  it("shows high-latency status banner for slow quality", () => {
    vi.mocked(useNetworkQuality).mockReturnValue({
      quality: "slow",
      latencyMs: 1200,
      jitterMs: 80,
      sampleCount: 3,
      refetch: vi.fn(),
    });

    renderStack();

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText(/Slow network/i)).toBeTruthy();
  });

  it("high-latency banner can be dismissed, then nothing renders", () => {
    vi.mocked(useNetworkQuality).mockReturnValue({
      quality: "degraded",
      latencyMs: 2500,
      jitterMs: 400,
      sampleCount: 5,
      refetch: vi.fn(),
    });

    renderStack();

    const dismissBtn = screen.getByRole("button", { name: /dismiss network quality/i });
    act(() => { fireEvent.click(dismissBtn); });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("high-latency banner takes priority over slow-connection", () => {
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOnline: true,
      isSlowConnection: true,
      effectiveType: "2g",
      downlink: undefined,
      saveData: false,
    });
    vi.mocked(useNetworkQuality).mockReturnValue({
      quality: "degraded",
      latencyMs: 2500,
      jitterMs: 400,
      sampleCount: 5,
      refetch: vi.fn(),
    });

    renderStack();

    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(screen.getByText(/Degraded network/i)).toBeTruthy();
    expect(screen.queryByText(/Slow connection detected/i)).toBeNull();
  });

  // ── Slow connection (priority 4) ────────────────────────────────────────

  it("shows slow-connection status banner as lowest priority", () => {
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOnline: true,
      isSlowConnection: true,
      effectiveType: "2g",
      downlink: undefined,
      saveData: false,
    });

    renderStack();

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Slow connection detected/i)).toBeTruthy();
  });

  it("slow-connection banner can be dismissed", () => {
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOnline: true,
      isSlowConnection: true,
      effectiveType: "3g",
      downlink: undefined,
      saveData: false,
    });

    renderStack();

    const dismissBtn = screen.getByRole("button", { name: /dismiss slow connection/i });
    act(() => { fireEvent.click(dismissBtn); });

    expect(screen.queryByRole("status")).toBeNull();
  });

  // ── Single role=alert policy ─────────────────────────────────────────────

  it("never renders more than one role=alert at a time", () => {
    // Activate all conditions simultaneously
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOnline: false,
      isSlowConnection: true,
      effectiveType: "2g",
      downlink: undefined,
      saveData: false,
    });
    vi.mocked(useWalletNetwork).mockReturnValue({
      isMismatch: true,
      walletNetwork: "Mainnet",
      expectedNetwork: "Testnet",
      isChecking: false,
      checkNow: vi.fn(),
    });
    vi.mocked(useNetworkQuality).mockReturnValue({
      quality: "degraded",
      latencyMs: 3000,
      jitterMs: 500,
      sampleCount: 5,
      refetch: vi.fn(),
    });

    renderStack(WALLET);

    const alerts = screen.queryAllByRole("alert");
    expect(alerts.length).toBeLessThanOrEqual(1);
  });

  it("never renders role=alert alongside role=status simultaneously", () => {
    vi.mocked(useWalletNetwork).mockReturnValue({
      isMismatch: true,
      walletNetwork: "Mainnet",
      expectedNetwork: "Testnet",
      isChecking: false,
      checkNow: vi.fn(),
    });
    vi.mocked(useNetworkQuality).mockReturnValue({
      quality: "degraded",
      latencyMs: 3000,
      jitterMs: 500,
      sampleCount: 5,
      refetch: vi.fn(),
    });

    renderStack(WALLET);

    const alerts = screen.queryAllByRole("alert");
    const statuses = screen.queryAllByRole("status");
    expect(alerts.length + statuses.length).toBeLessThanOrEqual(1);
  });

  // ── Success / online-restored state ─────────────────────────────────────

  it("shows success status (not alert) after coming back online", () => {
    // Start offline
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOnline: false,
      isSlowConnection: false,
      effectiveType: undefined,
      downlink: undefined,
      saveData: false,
    });

    const { rerender } = renderStack();
    expect(screen.getByRole("alert")).toBeTruthy();

    // Come back online
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOnline: true,
      isSlowConnection: false,
      effectiveType: undefined,
      downlink: undefined,
      saveData: false,
    });

    act(() => { rerender(
      <NetworkBannerStack walletAddress={null} lastKnownTvl={5_000_000} lastKnownBalance={1250.5} />
    ); });

    // Should now be a status, not an alert
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("success banner auto-dismisses after 4 seconds", () => {
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOnline: false,
      isSlowConnection: false,
      effectiveType: undefined,
      downlink: undefined,
      saveData: false,
    });

    const { rerender } = renderStack();

    vi.mocked(useNetworkStatus).mockReturnValue({
      isOnline: true,
      isSlowConnection: false,
      effectiveType: undefined,
      downlink: undefined,
      saveData: false,
    });

    act(() => {
      rerender(
        <NetworkBannerStack walletAddress={null} lastKnownTvl={5_000_000} lastKnownBalance={1250.5} />,
      );
    });

    // Advance past the 4-second auto-dismiss
    act(() => { vi.advanceTimersByTime(4_100); });

    expect(screen.queryByRole("status")).toBeNull();
  });

  // ── Retrying state ───────────────────────────────────────────────────────

  it("retrying state uses role=status not role=alert", () => {
    vi.mocked(useRetryState).mockReturnValue({
      isRetrying: true,
      secondsUntilRetry: 3,
    });

    renderStack();

    // isRetrying with isOnline=true → offline slot renders with status role
    const statusEl = screen.queryByRole("status");
    const alertEl = screen.queryByRole("alert");
    // Exactly one live region, and it must not be an assertive alert
    expect(alertEl).toBeNull();
    expect(statusEl).toBeTruthy();
  });
});
