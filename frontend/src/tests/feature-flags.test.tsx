import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureGate } from "../components/FeatureGate";
import {
  FeatureFlagProvider,
  useFeatureFlag,
} from "../context/FeatureFlagContext";

const { mockFetchPublicConfig } = vi.hoisted(() => ({
  mockFetchPublicConfig: vi.fn(),
}));

vi.mock("../lib/publicConfig", () => ({
  fetchPublicConfig: mockFetchPublicConfig,
}));

function publicConfig(features: Record<string, boolean | undefined>) {
  return {
    environment: "production",
    features,
    maintenanceMode: { enabled: false },
  };
}

function FlagProbe() {
  const enabled = useFeatureFlag("ANALYTICS_PAGE");
  return <div data-testid="flag-value">{String(enabled)}</div>;
}

describe("feature flags", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockFetchPublicConfig.mockReset();
    mockFetchPublicConfig.mockResolvedValue(publicConfig({}));
  });

  it("fails closed for non-true values", async () => {
    vi.stubEnv("VITE_FF_ANALYTICS_PAGE", "false");

    render(
      <FeatureFlagProvider>
        <FlagProbe />
      </FeatureFlagProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("flag-value")).toHaveTextContent("false"),
    );
  });

  it("enables a feature from the runtime config when the build-time flag is off", async () => {
    vi.stubEnv("VITE_FF_ANALYTICS_PAGE", "false");
    mockFetchPublicConfig.mockResolvedValue(
      publicConfig({ "analytics-page": true }),
    );

    render(
      <FeatureFlagProvider>
        <FlagProbe />
      </FeatureFlagProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("flag-value")).toHaveTextContent("true"),
    );
  });

  it("disables a feature from the runtime config when the build-time flag is on", async () => {
    vi.stubEnv("VITE_FF_ANALYTICS_PAGE", "true");
    mockFetchPublicConfig.mockResolvedValue(
      publicConfig({ "analytics-page": false }),
    );

    render(
      <FeatureFlagProvider>
        <FlagProbe />
      </FeatureFlagProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("flag-value")).toHaveTextContent("false"),
    );
  });

  it("keeps the build-time fallback when the runtime config request fails", async () => {
    vi.stubEnv("VITE_FF_ANALYTICS_PAGE", "true");
    mockFetchPublicConfig.mockRejectedValue(new Error("config unavailable"));

    render(
      <FeatureFlagProvider>
        <FlagProbe />
      </FeatureFlagProvider>,
    );

    await waitFor(() => expect(mockFetchPublicConfig).toHaveBeenCalled());
    expect(screen.getByTestId("flag-value")).toHaveTextContent("true");
  });

  it("renders fallback when a feature is disabled at runtime", async () => {
    vi.stubEnv("VITE_FF_ANALYTICS_PAGE", "true");
    mockFetchPublicConfig.mockResolvedValue(
      publicConfig({ "analytics-page": false }),
    );

    render(
      <FeatureFlagProvider>
        <FeatureGate
          flag="ANALYTICS_PAGE"
          fallback={<div>analytics fallback</div>}
        >
          <div>analytics enabled</div>
        </FeatureGate>
      </FeatureFlagProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("analytics fallback")).toBeInTheDocument(),
    );
    expect(screen.queryByText("analytics enabled")).not.toBeInTheDocument();
  });

  it("renders gated content when the feature is enabled at runtime", async () => {
    vi.stubEnv("VITE_FF_ANALYTICS_PAGE", "false");
    mockFetchPublicConfig.mockResolvedValue(
      publicConfig({ "analytics-page": true }),
    );

    render(
      <FeatureFlagProvider>
        <FeatureGate flag="ANALYTICS_PAGE">
          <div>analytics enabled</div>
        </FeatureGate>
      </FeatureFlagProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("analytics enabled")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Feature Unavailable")).not.toBeInTheDocument();
  });
});
