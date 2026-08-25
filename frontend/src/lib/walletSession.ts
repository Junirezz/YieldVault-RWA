/** Session flag: user chose Disconnect; skip Freighter auto-reconnect until they connect again. */
export const WALLET_MANUAL_DISCONNECT_KEY = "yieldvault_wallet_manual_disconnect";

export function isWalletManualDisconnectSet(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(WALLET_MANUAL_DISCONNECT_KEY) === "1";
}

export function setWalletManualDisconnect(): void {
  sessionStorage.setItem(WALLET_MANUAL_DISCONNECT_KEY, "1");
}

export function clearWalletManualDisconnect(): void {
  sessionStorage.removeItem(WALLET_MANUAL_DISCONNECT_KEY);
}

/** Persisted last-used wallet provider across sessions. */
export const WALLET_LAST_PROVIDER_KEY = "yieldvault_last_wallet_provider";

export type WalletProvider = "freighter";

export function getLastWalletProvider(): WalletProvider | null {
  if (typeof window === "undefined") return null;
  const value = localStorage.getItem(WALLET_LAST_PROVIDER_KEY);
  return value === "freighter" ? "freighter" : null;
}

export function setLastWalletProvider(provider: WalletProvider): void {
  localStorage.setItem(WALLET_LAST_PROVIDER_KEY, provider);
}

export function clearLastWalletProvider(): void {
  localStorage.removeItem(WALLET_LAST_PROVIDER_KEY);
}

/** Persisted connected wallet address for reload recovery. */
export const WALLET_CONNECTED_ADDRESS_KEY = "yieldvault_connected_wallet_address";

const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;

export function getPersistedWalletAddress(): string | null {
  if (typeof window === "undefined") return null;
  const value = localStorage.getItem(WALLET_CONNECTED_ADDRESS_KEY);
  return value && STELLAR_PUBLIC_KEY.test(value) ? value : null;
}

export function setPersistedWalletAddress(address: string): void {
  if (!STELLAR_PUBLIC_KEY.test(address)) return;
  localStorage.setItem(WALLET_CONNECTED_ADDRESS_KEY, address);
}

export function clearPersistedWalletAddress(): void {
  localStorage.removeItem(WALLET_CONNECTED_ADDRESS_KEY);
}

/** Session-scoped flag: user dismissed reconnect prompt in this session; prevent repeated prompts. */
export const WALLET_RECONNECT_PROMPT_DISMISS_KEY = "yieldvault_wallet_reconnect_prompt_dismissed";

export function isReconnectPromptDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(WALLET_RECONNECT_PROMPT_DISMISS_KEY) === "1";
}

export function setReconnectPromptDismissed(): void {
  sessionStorage.setItem(WALLET_RECONNECT_PROMPT_DISMISS_KEY, "1");
}

export function clearReconnectPromptDismissed(): void {
  sessionStorage.removeItem(WALLET_RECONNECT_PROMPT_DISMISS_KEY);
}

/** Check if the specified provider is available (installed and accessible). */
export async function isProviderAvailable(provider: WalletProvider): Promise<boolean> {
  if (typeof window === "undefined") return false;

  if (provider === "freighter") {
    try {
      const { isConnected } = await import("@stellar/freighter-api");
      const result = await isConnected();
      return result?.isConnected === true || typeof window !== "undefined";
    } catch {
      return false;
    }
  }

  return false;
}
