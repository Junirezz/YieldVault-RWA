import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import App from "../App";

vi.mock("../pages/Home", () => ({
  default: () => <div data-testid="route-home">Home</div>,
}));

vi.mock("../pages/Portfolio", () => ({
  default: () => <div data-testid="route-portfolio">Portfolio</div>,
}));

vi.mock("../pages/TransactionHistory", () => ({
  default: () => <div data-testid="route-transactions">Transactions</div>,
}));

vi.mock("../pages/VaultComparison", () => ({
  default: () => <div data-testid="route-compare">Compare</div>,
}));

vi.mock("../pages/Settings", () => ({
  default: () => <div data-testid="route-settings">Settings</div>,
}));

vi.mock("../pages/UIPreview", () => ({
  default: () => <div data-testid="route-ui-kit">UI Kit</div>,
}));

vi.mock("../pages/StrategyDetail", () => ({
  default: () => <div data-testid="route-strategy">Strategy Detail</div>,
}));

vi.mock("../pages/TransactionReceipt", () => ({
  default: () => <div data-testid="route-receipt">Receipt</div>,
}));

vi.mock("../pages/VaultHealthDashboard", () => ({
  default: () => <div data-testid="route-vault-health">Vault Health</div>,
}));

vi.mock("../pages/AuditLog", () => ({
  default: () => <div data-testid="route-audit-log">Audit Log</div>,
}));

vi.mock("../components/Navbar", () => ({
  default: () => <div data-testid="navbar">Navbar</div>,
}));

vi.mock("../components/ShortcutHelpModal", () => ({ default: () => null }));
vi.mock("../components/CommandPalette", () => ({ default: () => null }));
vi.mock("../components/OnboardingWalkthrough", () => ({ default: () => null }));
vi.mock("../components/ToastCenter", () => ({ default: () => null }));
vi.mock("../components/OfflineBanner", () => ({ default: () => null }));
vi.mock("../components/NetworkWarningBanner", () => ({ default: () => null }));
vi.mock("../components/HighLatencyBanner", () => ({ default: () => null }));

vi.mock("@sentry/react", () => ({
  withSentryReactRouterV6Routing: <T,>(comp: T) => comp,
  ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
  init: vi.fn(),
}));

vi.mock("../i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../hooks/useBalanceData", () => ({
  useUsdcBalance: () => ({ data: 1000, isLoading: false }),
  useXlmBalance: () => ({ data: 10.0, isLoading: false }),
}));

vi.mock("../hooks/useVaultData", () => ({
  useVaultSummary: () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }),
  useVaultHistory: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock("../hooks/useAnalytics", () => ({
  usePageViewTracking: () => undefined,
}));

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("route table smoke test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Each path must resolve to exactly one route definition: this guards the
  // #1564 deduplication, where duplicate <Route> entries could shadow one
  // another depending on ordering.
  const routes: Array<[string, string]> = [
    ["/", "route-home"],
    ["/portfolio", "route-portfolio"],
    ["/transactions", "route-transactions"],
    ["/compare", "route-compare"],
    ["/settings", "route-settings"],
    ["/vault-health", "route-vault-health"],
    ["/audit-log", "route-audit-log"],
    ["/ui-kit", "route-ui-kit"],
    ["/strategies/vault-1", "route-strategy"],
    ["/receipt/abc123", "route-receipt"],
  ];

  it.each(routes)("deep-links %s to a single route", async (path, testId) => {
    renderAt(path);

    await waitFor(() => {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    });

    expect(screen.getAllByTestId(testId)).toHaveLength(1);
  });

  it("renders the not-found boundary and redirects unknown paths home", async () => {
    renderAt("/this-route-does-not-exist");

    await waitFor(() => {
      expect(screen.getByTestId("route-home")).toBeInTheDocument();
    });
  });
});
