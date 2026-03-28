import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureGate } from "../components/FeatureGate";
import {
  FeatureFlagProvider,
  useFeatureFlag,
} from "../context/FeatureFlagContext";

function FlagProbe() {
  const enabled = useFeatureFlag("ANALYTICS_PAGE");
  return <div data-testid="flag-value">{String(enabled)}</div>;
}

describe("feature flags", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed for non-true values", () => {
    vi.stubEnv("VITE_FF_ANALYTICS_PAGE", "false");

    render(
      <FeatureFlagProvider>
        <FlagProbe />
      </FeatureFlagProvider>,
    );

    expect(screen.getByTestId("flag-value")).toHaveTextContent("false");
  });

  it("renders fallback when a feature is disabled", () => {
    vi.stubEnv("VITE_FF_ANALYTICS_PAGE", "false");

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

    expect(screen.queryByText("analytics enabled")).not.toBeInTheDocument();
    expect(screen.getByText("analytics fallback")).toBeInTheDocument();
  });

  it("renders gated content when the feature is enabled", () => {
    vi.stubEnv("VITE_FF_ANALYTICS_PAGE", "true");

    render(
      <FeatureFlagProvider>
        <FeatureGate flag="ANALYTICS_PAGE">
          <div>analytics enabled</div>
        </FeatureGate>
      </FeatureFlagProvider>,
    );

    expect(screen.getByText("analytics enabled")).toBeInTheDocument();
    expect(screen.queryByText("Feature Unavailable")).not.toBeInTheDocument();
  });
});
