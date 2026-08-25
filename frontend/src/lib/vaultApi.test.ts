import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const postMock = vi.hoisted(() => vi.fn());

vi.mock("./apiClient", () => ({
  apiClient: { post: postMock },
}));

import { submitDeposit, submitWithdrawal } from "./vaultApi";

const WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const DEPOSIT_PARAMS = {
  walletAddress: WALLET,
  amount: "100",
  asset: "USDC",
};

describe("vaultApi — transaction hash propagation", () => {
  beforeEach(() => {
    postMock.mockReset();
    vi.unstubAllEnvs();
    // Force the real-API code path; mock mode short-circuits below.
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    vi.stubEnv("VITE_E2E_STUB_BALANCES", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the camelCase transactionHash from a deposit response", async () => {
    postMock.mockResolvedValue({ id: "op-1", transactionHash: "abc123" });

    await expect(submitDeposit(DEPOSIT_PARAMS)).resolves.toBe("abc123");
  });

  it("accepts a snake_case tx_hash from a withdrawal response", async () => {
    postMock.mockResolvedValue({ id: "op-2", tx_hash: "def456" });

    await expect(
      submitWithdrawal({ ...DEPOSIT_PARAMS }),
    ).resolves.toBe("def456");
  });

  it("returns undefined when the response carries no hash", async () => {
    postMock.mockResolvedValue({ id: "op-3", status: "accepted" });

    await expect(submitDeposit(DEPOSIT_PARAMS)).resolves.toBeUndefined();
  });

  it("returns undefined for non-object responses", async () => {
    postMock.mockResolvedValue(null);

    await expect(submitDeposit(DEPOSIT_PARAMS)).resolves.toBeUndefined();
  });

  it("ignores empty-string hashes", async () => {
    postMock.mockResolvedValue({ transactionHash: "" });

    await expect(submitDeposit(DEPOSIT_PARAMS)).resolves.toBeUndefined();
  });

  it("propagates request failures untouched", async () => {
    postMock.mockRejectedValue(new Error("network down"));

    await expect(submitDeposit(DEPOSIT_PARAMS)).rejects.toThrow("network down");
  });

  it("resolves undefined in e2e stub mode without calling the API", async () => {
    vi.stubEnv("VITE_E2E_STUB_BALANCES", "true");

    await expect(submitDeposit(DEPOSIT_PARAMS)).resolves.toBeUndefined();
    expect(postMock).not.toHaveBeenCalled();
  });
});
