import { describe, it, expect } from "vitest";
import { createDepositFormSchema, MIN_DEPOSIT_AMOUNT } from "./depositFormSchema";
import { validate } from "../validate";

describe("Deposit Form Schema", () => {
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

  describe("amount range validation", () => {
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

    it("shows error when below minimum deposit", () => {
      const schema = createDepositFormSchema(100, false, 100, 0.01);
      const errors = validate(schema, { amount: "0.5" });
      expect(errors.amount).toBe(
        `Minimum deposit is ${MIN_DEPOSIT_AMOUNT.toFixed(2)} USDC.`
      );
    });

    it("accepts amount equal to minimum deposit", () => {
      const schema = createDepositFormSchema(100, false, 100, 0.01);
      const errors = validate(schema, { amount: MIN_DEPOSIT_AMOUNT.toString() });
      expect(errors.amount).toBeUndefined();
    });

    it("shows error when exceeds available balance", () => {
      const schema = createDepositFormSchema(50, false, 100, 0.01);
      const errors = validate(schema, { amount: "51" });
      expect(errors.amount).toContain("cannot exceed your available USDC balance");
    });

    it("accepts amount equal to available balance", () => {
      const schema = createDepositFormSchema(50, false, 100, 0.01);
      const errors = validate(schema, { amount: "50" });
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

  describe("amount format validation (API AmountSchema parity)", () => {
    it("rejects scientific notation", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "1e5" });
      expect(errors.amount).toBe(
        "Enter an amount using digits only, with up to 7 decimal places.",
      );
    });

    it("rejects more than 7 decimal places", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "1.12345678" });
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

    it("accepts exactly 7 decimal places", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "1.1234567" });
      expect(errors.amount).toBeUndefined();
    });
  });

  describe("valid deposits", () => {
    it("accepts valid deposit amount", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "100" });
      expect(errors.amount).toBeUndefined();
    });

    it("accepts valid decimal deposit amount", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "100.50" });
      expect(errors.amount).toBeUndefined();
    });

    it("accepts very small valid deposit amount", () => {
      const schema = createDepositFormSchema(1000, false, 100, 0.01);
      const errors = validate(schema, { amount: "1.01" });
      expect(errors.amount).toBeUndefined();
    });
  });
});
