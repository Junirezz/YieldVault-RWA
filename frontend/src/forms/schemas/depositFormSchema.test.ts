import { describe, it, expect } from "vitest";
import {
  buildMaxDepositError,
  buildPrecisionError,
  createDepositFormSchema,
  MAX_DEPOSIT_AMOUNT,
  MIN_DEPOSIT_AMOUNT,
  USDC_DISPLAY_DECIMALS,
} from "./depositFormSchema";
import { validate } from "../validate";

describe("Deposit Form Schema", () => {
  describe("exported constants", () => {
    it("MIN_DEPOSIT_AMOUNT is 1", () => {
      expect(MIN_DEPOSIT_AMOUNT).toBe(1);
    });

    it("MAX_DEPOSIT_AMOUNT is 1,000,000", () => {
      expect(MAX_DEPOSIT_AMOUNT).toBe(1_000_000);
    });

    it("USDC_DISPLAY_DECIMALS is 2", () => {
      expect(USDC_DISPLAY_DECIMALS).toBe(2);
    });
  });

  describe("buildMaxDepositError", () => {
    it("formats the max deposit error message with two decimal places", () => {
      expect(buildMaxDepositError(1_000_000)).toBe(
        "Maximum deposit is 1,000,000.00 USDC.",
      );
    });

    it("handles custom max amounts", () => {
      expect(buildMaxDepositError(500)).toBe("Maximum deposit is 500.00 USDC.");
    });
  });

  describe("buildPrecisionError", () => {
    it("uses plural 'places' for 2 decimals", () => {
      expect(buildPrecisionError(2)).toBe(
        "Enter an amount with up to 2 decimal places.",
      );
    });

    it("uses singular 'place' for 1 decimal", () => {
      expect(buildPrecisionError(1)).toBe(
        "Enter an amount with up to 1 decimal place.",
      );
    });
  });

  describe("required field validation", () => {
    it("shows error when amount is empty", () => {
      const schema = createDepositFormSchema(100, false, 100, 0.01);
      const errors = validate(schema, { amount: "" });
      expect(errors.amount).toBe("Amount is required.");
    });

    it("shows error when amount is whitespace only", () => {
      const schema = createDepositFormSchema(100, false, 100, 0.01);
      const errors = validate(schema, { amount: "   " });
      expect(errors.amount).toBe("Amount is required.");
    });
  });

  describe("number validation", () => {
    it("shows error for non-numeric input", () => {
      const schema = createDepositFormSchema(100, false, 100, 0.01);
      const errors = validate(schema, { amount: "abc" });
      expect(errors.amount).toBe("Enter a valid number.");
    });

    it("shows error for NaN", () => {
      const schema = createDepositFormSchema(100, false, 100, 0.01);
      const errors = validate(schema, { amount: String(Number.NaN) });
      expect(errors.amount).toBe("Enter a valid number.");
    });

    it("shows error for Infinity", () => {
      const schema = createDepositFormSchema(100, false, 100, 0.01);
      const errors = validate(schema, { amount: String(Number.POSITIVE_INFINITY) });
      expect(errors.amount).toBe("Enter a valid number.");
    });
  });

  describe("minimum amount validation", () => {
    it("shows error for zero amount", () => {
      const schema = createDepositFormSchema(100, false, 100, 0.01);
      const errors = validate(schema, { amount: "0" });
      expect(errors.amount).toBe("Amount must be greater than 0.");
    });

    it("shows error for negative amount", () => {
      const schema = createDepositFormSchema(100, false, 100, 0.01);
      const errors = validate(schema, { amount: "-10" });
      expect(errors.amount).toBe("Amount must be greater than 0.");
    });

    it("shows error when below minimum deposit threshold", () => {
      const schema = createDepositFormSchema(100, false, 100, 0.01);
      const errors = validate(schema, { amount: "0.5" });
      expect(errors.amount).toBe(
        `Minimum deposit is ${MIN_DEPOSIT_AMOUNT.toFixed(2)} USDC.`,
      );
    });

    it("accepts amount exactly equal to minimum deposit", () => {
      const schema = createDepositFormSchema(100, false, 100, 0.01);
      const errors = validate(schema, { amount: MIN_DEPOSIT_AMOUNT.toString() });
      expect(errors.amount).toBeUndefined();
    });

    it("accepts amount just above minimum deposit", () => {
      const schema = createDepositFormSchema(100, false, 100, 0.01);
      const errors = validate(schema, { amount: "1.01" });
      expect(errors.amount).toBeUndefined();
    });
  });

  describe("maximum amount validation", () => {
    it("shows error when amount exceeds default MAX_DEPOSIT_AMOUNT", () => {
      const schema = createDepositFormSchema(2_000_000, false, 100, 0.01);
      const errors = validate(schema, { amount: "1000001" });
      expect(errors.amount).toBe(buildMaxDepositError(MAX_DEPOSIT_AMOUNT));
    });

    it("accepts amount exactly equal to MAX_DEPOSIT_AMOUNT", () => {
      const schema = createDepositFormSchema(2_000_000, false, 100, 0.01);
      const errors = validate(schema, {
        amount: MAX_DEPOSIT_AMOUNT.toString(),
      });
      expect(errors.amount).toBeUndefined();
    });

    it("accepts amount just below MAX_DEPOSIT_AMOUNT", () => {
      const schema = createDepositFormSchema(2_000_000, false, 100, 0.01);
      const errors = validate(schema, { amount: "999999.99" });
      expect(errors.amount).toBeUndefined();
    });

    it("respects a custom maxAmount parameter", () => {
      const customMax = 5000;
      const schema = createDepositFormSchema(
        10_000,
        false,
        100,
        0.01,
        customMax,
      );
      const errors = validate(schema, { amount: "5001" });
      expect(errors.amount).toBe(buildMaxDepositError(customMax));
    });

    it("accepts amount exactly equal to a custom maxAmount", () => {
      const customMax = 5000;
      const schema = createDepositFormSchema(
        10_000,
        false,
        100,
        0.01,
        customMax,
      );
      const errors = validate(schema, { amount: "5000" });
      expect(errors.amount).toBeUndefined();
    });
  });

  describe("decimal precision validation", () => {
    it("shows error for more than USDC_DISPLAY_DECIMALS (2) decimal places", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "10.123" });
      expect(errors.amount).toBe(buildPrecisionError(USDC_DISPLAY_DECIMALS));
    });

    it("shows error for 3 decimal places with default precision", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "1.001" });
      expect(errors.amount).toBe(buildPrecisionError(2));
    });

    it("accepts exactly 2 decimal places", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "10.12" });
      expect(errors.amount).toBeUndefined();
    });

    it("accepts 1 decimal place", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "10.1" });
      expect(errors.amount).toBeUndefined();
    });

    it("accepts integer (no decimal point)", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "10" });
      expect(errors.amount).toBeUndefined();
    });

    it("respects a custom maxDecimals parameter", () => {
      const schema = createDepositFormSchema(
        1000,
        false,
        100,
        0.01,
        MAX_DEPOSIT_AMOUNT,
        4,
      );
      const errors = validate(schema, { amount: "10.12345" });
      expect(errors.amount).toBe(buildPrecisionError(4));
    });

    it("accepts up to custom maxDecimals", () => {
      const schema = createDepositFormSchema(
        1000,
        false,
        100,
        0.01,
        MAX_DEPOSIT_AMOUNT,
        4,
      );
      const errors = validate(schema, { amount: "10.1234" });
      expect(errors.amount).toBeUndefined();
    });
  });

  describe("vault capacity validation", () => {
    it("shows error when vault is at capacity", () => {
      const schema = createDepositFormSchema(100, true, 100, 0.01);
      const errors = validate(schema, { amount: "10" });
      expect(errors.amount).toContain("vault is at capacity");
    });

    it("accepts valid amount when vault not at capacity", () => {
      const schema = createDepositFormSchema(100, false, 100, 0.01);
      const errors = validate(schema, { amount: "10" });
      expect(errors.amount).toBeUndefined();
    });
  });

  describe("balance validation", () => {
    it("shows error when amount exceeds available balance", () => {
      const schema = createDepositFormSchema(50, false, 100, 0.01);
      const errors = validate(schema, { amount: "51" });
      expect(errors.amount).toContain("cannot exceed your available USDC balance");
    });

    it("accepts amount exactly equal to available balance", () => {
      const schema = createDepositFormSchema(50, false, 100, 0.01);
      const errors = validate(schema, { amount: "50" });
      expect(errors.amount).toBeUndefined();
    });
  });

  describe("XLM fee validation", () => {
    it("shows error when insufficient XLM for fees", () => {
      const schema = createDepositFormSchema(100, false, 0.001, 0.01);
      const errors = validate(schema, { amount: "10" });
      expect(errors.amount).toContain("Insufficient XLM balance");
    });

    it("accepts valid amount when sufficient XLM", () => {
      const schema = createDepositFormSchema(100, false, 1, 0.01);
      const errors = validate(schema, { amount: "10" });
      expect(errors.amount).toBeUndefined();
    });
  });

  describe("validation rule ordering", () => {
    it("reports minimum error before maximum error when both would apply", () => {
      // amount=0.5 is both below MIN and (trivially) within range
      // but the min check fires first
      const schema = createDepositFormSchema(100, false, 100, 0.01);
      const errors = validate(schema, { amount: "0.5" });
      expect(errors.amount).toBe(`Minimum deposit is ${MIN_DEPOSIT_AMOUNT.toFixed(2)} USDC.`);
    });

    it("reports precision error before balance error when both would apply", () => {
      // 1.999 has 3 dp (> 2) AND is within balance — precision check fires before balance
      const schema = createDepositFormSchema(5, false, 100, 0.01);
      const errors = validate(schema, { amount: "1.999" });
      expect(errors.amount).toBe(buildPrecisionError(2));
    });

    it("reports cap error before balance error", () => {
      const schema = createDepositFormSchema(100, true, 100, 0.01);
      const errors = validate(schema, { amount: "10" });
      expect(errors.amount).toContain("vault is at capacity");
    });
  });

  describe("amount format validation (API AmountSchema parity)", () => {
    it("rejects scientific notation", () => {
      const schema = createDepositFormSchema(1_500_000, false, 100, 0.01);
      const errors = validate(schema, { amount: "1e5" });
      expect(errors.amount).toBe(
        "Enter an amount using digits only, with up to 7 decimal places.",
      );
    });

    it("rejects leading plus sign", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "+10" });
      expect(errors.amount).toBe(
        "Enter an amount using digits only, with up to 7 decimal places.",
      );
    });

    it("rejects more than 7 API decimal places (format check precedes precision check)", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "1.12345678" });
      // The AMOUNT_PATTERN check in parseAmountInput fires first (>7 dp invalid format)
      expect(errors.amount).toBe(
        "Enter an amount using digits only, with up to 7 decimal places.",
      );
    });

    it("accepts exactly 2 decimal places (display precision)", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "1.12" });
      expect(errors.amount).toBeUndefined();
    });
  });

  describe("valid deposits", () => {
    it("accepts a typical deposit amount", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "100" });
      expect(errors.amount).toBeUndefined();
    });

    it("accepts a 2 decimal deposit amount", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "100.50" });
      expect(errors.amount).toBeUndefined();
    });

    it("accepts minimum deposit with 1 decimal place", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "1.5" });
      expect(errors.amount).toBeUndefined();
    });

    it("accepts large deposit within the max limit", () => {
      const schema = createDepositFormSchema(2_000_000, false, 100, 0.01);
      const errors = validate(schema, { amount: "999999" });
      expect(errors.amount).toBeUndefined();
    });
  });
});
