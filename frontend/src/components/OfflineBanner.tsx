import { useEffect, useState } from "react";

interface OfflineBannerProps {
  lastKnownTvl?: number;
  lastKnownBalance?: number;
}

export default function OfflineBanner({ lastKnownTvl, lastKnownBalance }: OfflineBannerProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="offline-banner" role="alert" aria-live="assertive">
      <div className="offline-banner__content">
        <span className="offline-banner__icon" aria-hidden="true">⚠️</span>
        <span>You are offline. Showing cached data.</span>
        {(lastKnownTvl !== undefined || lastKnownBalance !== undefined) && (
          <span className="offline-banner__data">
            {lastKnownTvl !== undefined && `TVL: $${lastKnownTvl.toLocaleString()}`}
            {lastKnownTvl !== undefined && lastKnownBalance !== undefined && " · "}
            {lastKnownBalance !== undefined && `Balance: ${lastKnownBalance.toFixed(2)} USDC`}
          </span>
        )}
      </div>
    </div>
  );
}
