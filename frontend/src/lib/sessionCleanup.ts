import type { QueryClient } from "@tanstack/react-query";

export const SESSION_STORAGE_KEYS = [
  "sessionToken",
  "accessToken",
  "refreshToken",
  "authToken",
  "walletAddress",
  "yv.auth.token",
  "yv.refresh.token",
  "yv.wallet.address",
] as const;

export const LOCAL_STORAGE_KEYS = [
  "wallet_session_start",
] as const;

export function clearWalletSessionState(queryClient: Pick<QueryClient, "clear">) {
  queryClient.clear();
  for (const key of SESSION_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
  for (const key of LOCAL_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}
