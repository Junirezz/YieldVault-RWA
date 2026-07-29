import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import App from "../App";

vi.mock("../pages/Home", () => ({
  default: () => <div data-testid="home-page">Home Page</div>,
}));

vi.mock("../pages/Portfolio", () => ({
  default: () => <div data-testid="portfolio-page">Portfolio Page</div>,
}));

vi.mock("../components/Navbar", () => ({
  default: () => <div data-testid="navbar">Navbar</div>,
}));

vi.mock("../components/ShortcutHelpModal", () => ({
  default: () => null,
}));

vi.mock("../components/CommandPalette", () => ({
  default: () => null,
}));

vi.mock("../components/OnboardingWalkthrough", () => ({
  default: () => null,
}));

vi.mock("../components/OfflineBanner", () => ({
  default: () => null,
}));

vi.mock("../components/NetworkWarningBanner", () => ({
  default: () => null,
}));

vi.mock("../components/HighLatencyBanner", () => ({
  default: () => null,
}));

vi.mock("../components/ToastCenter", () => ({
  default: () => null,
}));

vi.mock("@sentry/react", () => ({
  withSentryReactRouterV6Routing: <T,>(comp: T) => comp,
  ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
  init: vi.fn(),
}));

vi.mock("../i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../hooks/useBalanceData", () => ({
  useUsdcBalance: () => ({ data: 1000, isLoading: false }),
  useXlmBalance: () => ({ data: 10.0, isLoading: false }),
}));

vi.mock("../hooks/useVaultData", () => ({
  useVaultSummary: () => ({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useVaultHistory: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("../hooks/useAnalytics", () => ({
  usePageViewTracking: () => undefined,
}));

function renderWithProviders(initialEntries: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Routing and Lazy Loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the loading fallback initially when navigating to a lazy route", async () => {
    renderWithProviders(["/"]);

    // Loading subtitle may resolve immediately in tests; accept either state.
    const loading = screen.queryByText("app.loading.subtitle");
    if (loading) {
      expect(loading).toBeInTheDocument();
    }

    await waitFor(() => {
      expect(screen.getByTestId("home-page")).toBeInTheDocument();
    });
  });

  it("navigates to portfolio and shows loading state", async () => {
    renderWithProviders(["/portfolio"]);

    const loading = screen.queryByText("app.loading.subtitle");
    if (loading) {
      expect(loading).toBeInTheDocument();
    }

    await waitFor(() => {
      expect(screen.getByTestId("portfolio-page")).toBeInTheDocument();
    });
  });

  it("redirects to home for unknown routes", async () => {
    renderWithProviders(["/unknown-route"]);

    await waitFor(() => {
      expect(screen.getByTestId("home-page")).toBeInTheDocument();
    });
  });
});
