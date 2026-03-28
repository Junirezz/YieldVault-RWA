import React from "react";
import { ShieldOff } from "lucide-react";
import { useFeatureFlag } from "../context/FeatureFlagContext";
import type { FeatureFlagKey } from "../context/FeatureFlagContext";

interface FeatureGateProps {
  flag: FeatureFlagKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}
const DefaultFallback: React.FC = () => (
  <div className="glass-panel feature-gate-fallback" role="status" aria-live="polite">
    <div className="feature-gate-icon" aria-hidden="true">
      <ShieldOff size={18} />
    </div>
    <span className="tag cyan feature-gate-tag">Controlled Rollout</span>
    <div className="text-gradient feature-gate-title">
      Feature Unavailable
    </div>
    <div className="feature-gate-description">
      This section is currently disabled for this environment. It will be
      enabled as rollout progresses.
    </div>
  </div>
);

export const FeatureGate: React.FC<FeatureGateProps> = ({ flag, children, fallback }) => {
  const enabled = useFeatureFlag(flag);
  if (!enabled) return <>{fallback ?? <DefaultFallback />}</>;
  return <>{children}</>;
};
