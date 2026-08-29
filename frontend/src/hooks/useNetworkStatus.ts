import { useState, useEffect } from "react";

export type ConnectionEffectiveType = "slow-2g" | "2g" | "3g" | "4g";

interface NetworkInformation extends EventTarget {
  readonly effectiveType?: ConnectionEffectiveType;
  readonly downlink?: number;
  readonly saveData?: boolean;
}

type NavigatorWithConnection = Navigator & {
  connection?: NetworkInformation;
  mozConnection?: NetworkInformation;
  webkitConnection?: NetworkInformation;
};

const SLOW_EFFECTIVE_TYPES = new Set<ConnectionEffectiveType>(["slow-2g", "2g"]);
const SLOW_DOWNLINK_MBPS = 0.5;

function getConnection(): NetworkInformation | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as NavigatorWithConnection;
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

function isSlowConnection(connection?: NetworkInformation): boolean {
  if (!connection) return false;
  if (connection.effectiveType && SLOW_EFFECTIVE_TYPES.has(connection.effectiveType)) {
    return true;
  }
  return typeof connection.downlink === "number" && connection.downlink < SLOW_DOWNLINK_MBPS;
}

/**
 * Hook that tracks the browser's online/offline status and, where supported,
 * the connection speed reported by the Network Information API
 * (navigator.connection). Subscribes to 'online'/'offline' window events and
 * the connection's 'change' event, initializing from navigator.onLine and
 * navigator.connection.
 *
 * @example
 * ```tsx
 * const { isOnline, isSlowConnection } = useNetworkStatus();
 * if (!isOnline || isSlowConnection) {
 *   return <NetworkBanner />;
 * }
 * ```
 */
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" && navigator.onLine
  );
  const [effectiveType, setEffectiveType] = useState(getConnection()?.effectiveType);
  const [downlink, setDownlink] = useState(getConnection()?.downlink);
  const [saveData, setSaveData] = useState(Boolean(getConnection()?.saveData));
  const [isSlow, setIsSlow] = useState(() => isSlowConnection(getConnection()));

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const connection = getConnection();
    if (!connection) return;

    const handleChange = () => {
      setEffectiveType(connection.effectiveType);
      setDownlink(connection.downlink);
      setSaveData(Boolean(connection.saveData));
      setIsSlow(isSlowConnection(connection));
    };

    handleChange();
    connection.addEventListener?.("change", handleChange);
    return () => connection.removeEventListener?.("change", handleChange);
  }, []);

  return { isOnline, effectiveType, downlink, saveData, isSlowConnection: isSlow };
}
