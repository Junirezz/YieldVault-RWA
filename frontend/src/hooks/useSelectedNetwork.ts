import { useCallback, useSyncExternalStore } from "react";
import {
  configuredNetwork,
  getNetworkConfig,
  type NetworkConfig,
} from "../config/network";
import {
  getSelectedNetwork,
  networkLabel,
  setSelectedNetwork as persistSelectedNetwork,
  subscribeSelectedNetwork,
  type StellarNetwork,
} from "../config/selectedNetwork";

/**
 * Read and update the persisted network selection. Every consumer shares the
 * same store, so changing it in one place updates the banner, the badge and
 * all derived RPC/explorer URLs throughout the app.
 */
export function useSelectedNetwork() {
  const selectedNetwork = useSyncExternalStore(
    subscribeSelectedNetwork,
    () => getSelectedNetwork(configuredNetwork),
    () => configuredNetwork,
  );

  const setNetwork = useCallback((network: StellarNetwork) => {
    persistSelectedNetwork(network);
  }, []);

  const activeConfig: NetworkConfig = getNetworkConfig(selectedNetwork);

  return {
    selectedNetwork,
    setSelectedNetwork: setNetwork,
    expectedNetwork: networkLabel(selectedNetwork),
    activeConfig,
  };
}
