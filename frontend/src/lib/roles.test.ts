import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveUserRole, roleAllows } from "./roles";

describe("resolveUserRole", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns guest when no wallet is connected", () => {
    expect(resolveUserRole(null)).toBe("guest");
    expect(resolveUserRole(undefined)).toBe("guest");
    expect(resolveUserRole("")).toBe("guest");
  });

  it("returns investor for a connected wallet not on the admin list", () => {
    vi.stubEnv("VITE_ADMIN_WALLETS", "GADMIN1,GADMIN2");
    expect(resolveUserRole("GORDINARYWALLET")).toBe("investor");
  });

  it("returns admin for a wallet on the admin list", () => {
    vi.stubEnv("VITE_ADMIN_WALLETS", "GADMIN1,GADMIN2");
    expect(resolveUserRole("GADMIN2")).toBe("admin");
  });

  it("matches admin wallets case-insensitively and ignores whitespace", () => {
    vi.stubEnv("VITE_ADMIN_WALLETS", " gAdmin1 , GADMIN2");
    expect(resolveUserRole("gadmin1")).toBe("admin");
  });

  it("treats an empty admin list as no admins", () => {
    vi.stubEnv("VITE_ADMIN_WALLETS", "");
    expect(resolveUserRole("GANYWALLET")).toBe("investor");
  });
});

describe("roleAllows", () => {
  it("returns true when the role is in the allow list", () => {
    expect(roleAllows("admin", ["investor", "admin"])).toBe(true);
  });

  it("returns false when the role is not in the allow list", () => {
    expect(roleAllows("guest", ["investor", "admin"])).toBe(false);
  });
});
