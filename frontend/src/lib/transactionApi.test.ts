import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatTimestamp,
  normalizeOperation,
  truncateHash,
  type Transaction,
} from "./transactionApi";

const WALLET = "GAWALLETSIGNERADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function makeOperation(
  overrides: Partial<Parameters<typeof normalizeOperation>[0]> = {},
): Parameters<typeof normalizeOperation>[0] {
  return {
    id: "123456789",
    type: "payment",
    from: "GSOURCEACCOUNTSIGNERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    to: WALLET,
    amount: "10.0000000",
    asset_type: "native",
    created_at: "2026-08-01T12:00:00Z",
    transaction_hash: "abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
    ...overrides,
  };
}

describe("normalizeOperation", () => {
  it("marks an operation from a successful transaction as completed", () => {
    const tx = normalizeOperation(makeOperation({ transaction_successful: true }), WALLET);
    expect(tx.status).toBe("completed");
  });

  it("marks an operation from a failed transaction as failed", () => {
    const tx = normalizeOperation(makeOperation({ transaction_successful: false }), WALLET);
    expect(tx.status).toBe("failed");
  });

  it("treats a missing transaction_successful flag as completed", () => {
    const tx = normalizeOperation(makeOperation(), WALLET);
    expect(tx.status).toBe("completed");
  });

  it("classifies incoming funds as deposits", () => {
    const tx = normalizeOperation(makeOperation(), WALLET);
    expect(tx.type).toBe("deposit");
  });

  it("classifies outgoing funds as withdrawals", () => {
    const tx = normalizeOperation(makeOperation({ to: "GOTHERRECIPIENTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }), WALLET);
    expect(tx.type).toBe("withdrawal");
  });

  it("maps the native asset to XLM and keeps asset codes for issued assets", () => {
    const native = normalizeOperation(makeOperation(), WALLET);
    expect(native.asset).toBe("XLM");

    const issued = normalizeOperation(
      makeOperation({ asset_type: "credit_alphanum4", asset_code: "USDC" }),
      WALLET,
    );
    expect(issued.asset).toBe("USDC");
  });

  it("preserves the timestamp and transaction hash used by filters and explorer links", () => {
    const tx = normalizeOperation(makeOperation(), WALLET);
    expect(tx.timestamp).toBe("2026-08-01T12:00:00Z");
    expect(tx.transactionHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("formatAmount", () => {
  it("formats amounts with their asset code", () => {
    expect(formatAmount("10.0000000", "XLM")).toMatch(/^10(\.00)? XLM$/);
  });

  it("returns a dash when amount or asset is missing", () => {
    expect(formatAmount(null, "XLM")).toBe("—");
    expect(formatAmount("10.0000000", null)).toBe("—");
  });

  it("returns a dash for non-numeric amounts", () => {
    expect(formatAmount("not-a-number", "XLM")).toBe("—");
  });
});

describe("formatTimestamp", () => {
  it("formats ISO timestamps into a readable date string", () => {
    const formatted = formatTimestamp("2026-08-01T12:00:00Z");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("Aug");
  });
});

describe("truncateHash", () => {
  it("shortens long hashes while keeping both ends recognisable", () => {
    const hash = "a".repeat(30) + "b".repeat(34);
    const truncated = truncateHash(hash);
    expect(truncated).toMatch(/^a{8}\.\.\.b{4}$/);
    expect(truncated.length).toBeLessThan(hash.length);
  });
});

describe("Transaction type shape", () => {
  it("keeps statuses within the filter vocabulary used by the history table", () => {
    const validStatuses: Transaction["status"][] = ["pending", "completed", "failed"];
    const derived = normalizeOperation(makeOperation({ transaction_successful: false }), WALLET);
    expect(validStatuses).toContain(derived.status);
  });
});
