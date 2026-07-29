/**
 * Client-side user roles for nav visibility and route gating.
 *
 * This is a UI convenience layer, not a security boundary: the admin
 * wallet list ships in the client bundle, so any privileged action it
 * gates must still be authorized server-side (see backend/src/middleware/rbac.ts).
 */
export const USER_ROLES = ["guest", "investor", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

function normalizeAddress(address: string): string {
  return address.trim().toUpperCase();
}

function getAdminWallets(): string[] {
  const raw: string = import.meta.env.VITE_ADMIN_WALLETS || "";
  return raw
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean)
    .map(normalizeAddress);
}

/**
 * Resolves the current user's role from their connected wallet address.
 * - No wallet connected -> "guest"
 * - Wallet connected and listed in VITE_ADMIN_WALLETS -> "admin"
 * - Any other connected wallet -> "investor"
 */
export function resolveUserRole(walletAddress: string | null | undefined): UserRole {
  if (!walletAddress) return "guest";
  return getAdminWallets().includes(normalizeAddress(walletAddress)) ? "admin" : "investor";
}

export function roleAllows(role: UserRole, allow: readonly UserRole[]): boolean {
  return allow.includes(role);
}
