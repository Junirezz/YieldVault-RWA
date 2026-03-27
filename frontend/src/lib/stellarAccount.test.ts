import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverConnectedAddress, fetchUsdcBalance } from "./stellarAccount";
import * as freighter from "@stellar/freighter-api";
import { Horizon } from "@stellar/stellar-sdk";

vi.mock("@stellar/freighter-api", () => ({
  isAllowed: vi.fn(),
  getAddress: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: vi.fn(),
  },
}));

const mockedFreighter = vi.mocked(freighter);
const mockedServer = vi.mocked(Horizon.Server);

describe("stellarAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when Freighter is not allowed", async () => {
    mockedFreighter.isAllowed.mockResolvedValue({ isAllowed: false });

    await expect(discoverConnectedAddress()).resolves.toBeNull();
  });

  it("returns discovered address when Freighter is allowed", async () => {
    mockedFreighter.isAllowed.mockResolvedValue({ isAllowed: true });
    mockedFreighter.getAddress.mockResolvedValue({ address: "GABC123" });

    await expect(discoverConnectedAddress()).resolves.toBe("GABC123");
  });

  it("extracts USDC balance from account balances", async () => {
    const call = vi.fn().mockResolvedValue({
      balances: [
        { asset_type: "native", balance: "10.0000000" },
        { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "42.5" },
      ],
    });
    const accountId = vi.fn().mockReturnValue({ call });
    mockedServer.mockImplementation(function () {
      return {
        accounts: () => ({ accountId }),
      } as unknown as Horizon.Server;
    });

    await expect(fetchUsdcBalance("GABC123")).resolves.toBe(42.5);
  });
});
