/**
 * Persisted network selection.
 *
 * The selection is stored as a versioned envelope so its shape can be migrated
 * later (see `lib/versionedStorage`). It is deliberately kept out of the
 * wallet-session cleanup keys: choosing a network is a user preference and
 * must survive both reloads and wallet disconnects.
 */
import { readVersionedItem, writeVersionedItem } from "../lib/versionedStorage";

export type StellarNetwork = "testnet" | "mainnet";

export const SELECTED_NETWORK_STORAGE_KEY = "yieldvault.selected_network";
export const SELECTED_NETWORK_STORAGE_VERSION = 1;

type Listener = () => void;
const listeners = new Set<Listener>();
let storageListenerAttached = false;

export function isStellarNetwork(value: unknown): value is StellarNetwork {
  return value === "testnet" || value === "mainnet";
}

function normalizeNetwork(value: unknown): StellarNetwork | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : value;
  return isStellarNetwork(normalized) ? normalized : null;
}

/** Read the persisted selection, migrating a legacy raw `"testnet"`/`"mainnet"` value. */
export function readSelectedNetwork(): StellarNetwork | null {
  return readVersionedItem<StellarNetwork>(SELECTED_NETWORK_STORAGE_KEY, {
    version: SELECTED_NETWORK_STORAGE_VERSION,
    parseData: normalizeNetwork,
    migrateLegacy: normalizeNetwork,
  });
}

/**
 * Current selection. `defaultNetwork` is the network baked into the build; it
 * is used until the user explicitly picks a network.
 */
export function getSelectedNetwork(defaultNetwork: StellarNetwork = "testnet"): StellarNetwork {
  return readSelectedNetwork() ?? defaultNetwork;
}

export function setSelectedNetwork(network: StellarNetwork): void {
  const valid = normalizeNetwork(network);
  if (!valid) return;
  writeVersionedItem(SELECTED_NETWORK_STORAGE_KEY, SELECTED_NETWORK_STORAGE_VERSION, valid);
  notifyListeners();
}

export function networkLabel(network: StellarNetwork): string {
  return network === "mainnet" ? "Mainnet" : "Testnet";
}

/** Subscribe to in-app changes and changes made by another tab. */
export function subscribeSelectedNetwork(listener: Listener): () => void {
  listeners.add(listener);

  if (typeof window !== "undefined" && !storageListenerAttached) {
    window.addEventListener("storage", onStorageChange);
    storageListenerAttached = true;
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined" && storageListenerAttached) {
      window.removeEventListener("storage", onStorageChange);
      storageListenerAttached = false;
    }
  };
}

function notifyListeners(): void {
  for (const listener of [...listeners]) listener();
}

function onStorageChange(event: StorageEvent): void {
  if (event.key === SELECTED_NETWORK_STORAGE_KEY || event.key === null) {
    notifyListeners();
  }
}
