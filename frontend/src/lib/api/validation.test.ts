import { describe, expect, it } from "vitest";
import { validate, validateAsync, isValidationError, ValidationError } from "./validation";
import {
  DepositRequestSchema,
  WithdrawalRequestSchema,
  VaultHistoryQuerySchema,
  PortfolioQuerySchema,
  TransactionQuerySchema,
  StellarAddressSchema,
  AmountSchema,
} from "./schemas";

/**
 * A real 56-character Stellar testnet public key (G + 55 StrKey Base32 chars).
 * Used across all tests as the canonical valid wallet address.
 */
const VALID_ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

describe("StellarAddressSchema", () => {
  it("accepts a valid G... address (56 chars)", () => {
    expect(validate(StellarAddressSchema, VALID_ADDRESS)).toBe(VALID_ADDRESS);
  });

  it("rejects an empty string", () => {
    expect(() => validate(StellarAddressSchema, "")).toThrow(ValidationError);
  });

  it("rejects an address that starts with a different letter", () => {
    // Stellar secret keys start with S — not a valid public key
    expect(() =>
      validate(StellarAddressSchema, "SBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
    ).toThrow(ValidationError);
  });

  it("rejects an address that is too short", () => {
    expect(() => validate(StellarAddressSchema, "GSHORT")).toThrow(ValidationError);
  });

  it("rejects a non-string input", () => {
    expect(() => validate(StellarAddressSchema, 12345)).toThrow(ValidationError);
  });

  it("trims surrounding whitespace and still validates a correct address", () => {
    const padded = `  ${VALID_ADDRESS}  `;
    expect(validate(StellarAddressSchema, padded)).toBe(VALID_ADDRESS);
  });
});

describe("AmountSchema", () => {
  it("accepts a whole number string", () => {
    expect(validate(AmountSchema, "100")).toBe("100");
  });

  it("accepts a decimal string with up to 7 decimal places", () => {
    expect(validate(AmountSchema, "0.0000001")).toBe("0.0000001");
  });

  it("rejects zero", () => {
    expect(() => validate(AmountSchema, "0")).toThrow(ValidationError);
  });

  it("rejects a negative amount", () => {
    expect(() => validate(AmountSchema, "-5")).toThrow(ValidationError);
  });

  it("rejects more than 7 decimal places", () => {
    expect(() => validate(AmountSchema, "1.00000001")).toThrow(ValidationError);
  });

  it("rejects a non-numeric string", () => {
    expect(() => validate(AmountSchema, "abc")).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// DepositRequestSchema
// ---------------------------------------------------------------------------

describe("DepositRequestSchema", () => {
  const validDeposit = {
    walletAddress: VALID_ADDRESS,
    amount: "500",
    asset: "USDC" as const,
  };

  it("accepts a valid deposit payload", () => {
    expect(() => validate(DepositRequestSchema, validDeposit)).not.toThrow();
  });

  it("accepts optional slippageBps within range", () => {
    expect(() =>
      validate(DepositRequestSchema, { ...validDeposit, slippageBps: 50 }),
    ).not.toThrow();
  });

  it("rejects a missing walletAddress", () => {
    expect(() =>
      validate(DepositRequestSchema, { amount: "10", asset: "USDC" }),
    ).toThrow(ValidationError);
  });

  it("rejects a missing amount", () => {
    expect(() =>
      validate(DepositRequestSchema, { walletAddress: VALID_ADDRESS, asset: "USDC" }),
    ).toThrow(ValidationError);
  });

  it("rejects zero amount", () => {
    expect(() =>
      validate(DepositRequestSchema, { ...validDeposit, amount: "0" }),
    ).toThrow(ValidationError);
  });

  it("rejects an unsupported asset", () => {
    expect(() =>
      validate(DepositRequestSchema, { ...validDeposit, asset: "BTC" }),
    ).toThrow(ValidationError);
  });

  it("rejects slippageBps above 500", () => {
    expect(() =>
      validate(DepositRequestSchema, { ...validDeposit, slippageBps: 501 }),
    ).toThrow(ValidationError);
  });

  it("rejects negative slippageBps", () => {
    expect(() =>
      validate(DepositRequestSchema, { ...validDeposit, slippageBps: -1 }),
    ).toThrow(ValidationError);
  });

  it("includes field-level detail for the offending field", () => {
    let caught: ValidationError | undefined;
    try {
      validate(DepositRequestSchema, { ...validDeposit, amount: "0" }, "DepositRequest");
    } catch (e) {
      if (isValidationError(e)) caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught!.details.some((d) => d.field === "amount")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WithdrawalRequestSchema
// ---------------------------------------------------------------------------

describe("WithdrawalRequestSchema", () => {
  const validWithdrawal = {
    walletAddress: VALID_ADDRESS,
    shares: 100,
    asset: "yUSDC" as const,
  };

  it("accepts a valid withdrawal payload", () => {
    expect(() => validate(WithdrawalRequestSchema, validWithdrawal)).not.toThrow();
  });

  it("accepts an optional destination address", () => {
    expect(() =>
      validate(WithdrawalRequestSchema, {
        ...validWithdrawal,
        destinationAddress: VALID_ADDRESS,
      }),
    ).not.toThrow();
  });

  it("rejects zero shares", () => {
    expect(() =>
      validate(WithdrawalRequestSchema, { ...validWithdrawal, shares: 0 }),
    ).toThrow(ValidationError);
  });

  it("rejects fractional shares", () => {
    expect(() =>
      validate(WithdrawalRequestSchema, { ...validWithdrawal, shares: 1.5 }),
    ).toThrow(ValidationError);
  });

  it("rejects an invalid destination address", () => {
    expect(() =>
      validate(WithdrawalRequestSchema, {
        ...validWithdrawal,
        destinationAddress: "not-a-stellar-address",
      }),
    ).toThrow(ValidationError);
  });

  it("rejects a missing walletAddress", () => {
    expect(() =>
      validate(WithdrawalRequestSchema, { shares: 10, asset: "XLM" }),
    ).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// VaultHistoryQuerySchema
// ---------------------------------------------------------------------------

describe("VaultHistoryQuerySchema", () => {
  it("accepts two valid dates where from <= to", () => {
    expect(() =>
      validate(VaultHistoryQuerySchema, { from: "2025-01-01", to: "2025-12-31" }),
    ).not.toThrow();
  });

  it("accepts an empty object (all fields are optional)", () => {
    expect(() => validate(VaultHistoryQuerySchema, {})).not.toThrow();
  });

  it("rejects from > to with a 'from' field-level detail", () => {
    let caught: unknown;
    try {
      validate(VaultHistoryQuerySchema, { from: "2026-01-01", to: "2025-01-01" });
    } catch (e) {
      caught = e;
    }
    expect(isValidationError(caught)).toBe(true);
    expect((caught as ValidationError).details.some((d) => d.field === "from")).toBe(true);
  });

  it("rejects a malformed date string", () => {
    expect(() =>
      validate(VaultHistoryQuerySchema, { from: "25-01-01" }),
    ).toThrow(ValidationError);
  });

  it("rejects limit > 365", () => {
    expect(() =>
      validate(VaultHistoryQuerySchema, { limit: 366 }),
    ).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// PortfolioQuerySchema
// ---------------------------------------------------------------------------

describe("PortfolioQuerySchema", () => {
  it("accepts a valid address and defaults status to 'all'", () => {
    const result = validate(PortfolioQuerySchema, { walletAddress: VALID_ADDRESS });
    expect(result.status).toBe("all");
  });

  it("accepts an explicit status filter", () => {
    const result = validate(PortfolioQuerySchema, {
      walletAddress: VALID_ADDRESS,
      status: "active",
    });
    expect(result.status).toBe("active");
  });

  it("rejects an invalid status value", () => {
    expect(() =>
      validate(PortfolioQuerySchema, { walletAddress: VALID_ADDRESS, status: "closed" }),
    ).toThrow(ValidationError);
  });

  it("rejects a missing walletAddress", () => {
    expect(() => validate(PortfolioQuerySchema, {})).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// TransactionQuerySchema
// ---------------------------------------------------------------------------

describe("TransactionQuerySchema", () => {
  it("applies default limit=50, order=desc, type=all", () => {
    const result = validate(TransactionQuerySchema, { walletAddress: VALID_ADDRESS });
    expect(result.limit).toBe(50);
    expect(result.order).toBe("desc");
    expect(result.type).toBe("all");
  });

  it("accepts a custom limit within range", () => {
    const result = validate(TransactionQuerySchema, {
      walletAddress: VALID_ADDRESS,
      limit: 100,
    });
    expect(result.limit).toBe(100);
  });

  it("rejects limit above 200", () => {
    expect(() =>
      validate(TransactionQuerySchema, { walletAddress: VALID_ADDRESS, limit: 201 }),
    ).toThrow(ValidationError);
  });

  it("rejects an invalid order value", () => {
    expect(() =>
      validate(TransactionQuerySchema, { walletAddress: VALID_ADDRESS, order: "random" }),
    ).toThrow(ValidationError);
  });

  it("rejects a missing walletAddress", () => {
    expect(() => validate(TransactionQuerySchema, { limit: 10 })).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// validate() / validateAsync() utilities
// ---------------------------------------------------------------------------

describe("validate()", () => {
  it("returns the parsed value on success", () => {
    expect(validate(AmountSchema, "42.5")).toBe("42.5");
  });

  it("throws ValidationError (not a generic Error) on failure", () => {
    let caught: unknown;
    try {
      validate(AmountSchema, "bad");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(isValidationError(caught)).toBe(true);
  });

  it("includes the context label in the error message when provided", () => {
    let caught: ValidationError | undefined;
    try {
      validate(AmountSchema, "0", "DepositAmount");
    } catch (e) {
      if (isValidationError(e)) caught = e;
    }
    expect(caught?.message).toMatch(/\[DepositAmount\]/);
  });

  it("error.toJSON() returns the canonical shape", () => {
    let caught: ValidationError | undefined;
    try {
      validate(AmountSchema, "bad");
    } catch (e) {
      if (isValidationError(e)) caught = e;
    }
    const json = caught!.toJSON();
    expect(json).toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.any(String),
      userMessage: expect.any(String),
      details: expect.arrayContaining([
        expect.objectContaining({ field: expect.any(String), message: expect.any(String) }),
      ]),
    });
  });
});

describe("validateAsync()", () => {
  it("resolves with the parsed value on success", async () => {
    await expect(validateAsync(AmountSchema, "1.5")).resolves.toBe("1.5");
  });

  it("rejects with ValidationError on failure", async () => {
    await expect(validateAsync(AmountSchema, "-1")).rejects.toBeInstanceOf(ValidationError);
  });
});
