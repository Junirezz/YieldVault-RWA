import { describe, it, expect } from "vitest";
import { createWithdrawFormSchema } from "./withdrawFormSchema";
import { validate } from "../validate";

describe("Withdraw Form Schema", () => {
  describe("required field validation", () => {
    it("shows error when amount is empty", () => {
      const schema = createWithdrawFormSchema(100);
      const errors = validate(schema, { amount: "" });
      expect(errors.amount).toBe("Amount is required.");
    });

    it("shows error when amount is whitespace only", () => {
      const schema = createWithdrawFormSchema(100);
      const errors = validate(schema, { amount: "   " });
      expect(errors.amount).toBe("Amount is required.");
    });
  });

  describe("number validation", () => {
    it("shows error for non-numeric input", () => {
      const schema = createWithdrawFormSchema(100);
      const errors = validate(schema, { amount: "abc" });
      expect(errors.amount).toBe("Enter a valid number.");
    });

    it("shows error for NaN", () => {
      const schema = createWithdrawFormSchema(100);
      const errors = validate(schema, { amount: String(Number.NaN) });
      expect(errors.amount).toBe("Enter a valid number.");
    });

    it("shows error for Infinity", () => {
      const schema = createWithdrawFormSchema(100);
      const errors = validate(schema, { amount: String(Number.POSITIVE_INFINITY) });
      expect(errors.amount).toBe("Enter a valid number.");
    });
  });

  describe("amount range validation", () => {
    it("shows error for zero amount", () => {
      const schema = createWithdrawFormSchema(100);
      const errors = validate(schema, { amount: "0" });
      expect(errors.amount).toBe("Amount must be greater than 0.");
    });

    it("shows error for negative amount", () => {
      const schema = createWithdrawFormSchema(100);
      const errors = validate(schema, { amount: "-10" });
      expect(errors.amount).toBe("Amount must be greater than 0.");
    });

    it("shows error when exceeds vault balance", () => {
      const schema = createWithdrawFormSchema(50);
      const errors = validate(schema, { amount: "51" });
      expect(errors.amount).toContain("cannot exceed your available vault balance");
    });

    it("accepts amount equal to vault balance", () => {
      const schema = createWithdrawFormSchema(50);
      const errors = validate(schema, { amount: "50" });
      expect(errors.amount).toBeUndefined();
    });
  });

  describe("amount format validation (API AmountSchema parity)", () => {
    it("rejects scientific notation", () => {
      const schema = createWithdrawFormSchema(1000);
      const errors = validate(schema, { amount: "1e5" });
      expect(errors.amount).toBe(
        "Enter an amount using digits only, with up to 7 decimal places.",
      );
    });

    it("rejects more than 7 decimal places", () => {
      const schema = createWithdrawFormSchema(1000);
      const errors = validate(schema, { amount: "1.12345678" });
      expect(errors.amount).toBe(
        "Enter an amount using digits only, with up to 7 decimal places.",
      );
    });

    it("accepts exactly 7 decimal places", () => {
      const schema = createWithdrawFormSchema(1000);
      const errors = validate(schema, { amount: "1.1234567" });
      expect(errors.amount).toBeUndefined();
    });
  });

  describe("XLM fee validation", () => {
    it("shows error when insufficient XLM for fees", () => {
      const schema = createWithdrawFormSchema(100, 0.001, 0.01);
      const errors = validate(schema, { amount: "10" });
      expect(errors.amount).toContain("Insufficient XLM balance");
    });

    it("accepts valid amount when sufficient XLM", () => {
      const schema = createWithdrawFormSchema(100, 1, 0.01);
      const errors = validate(schema, { amount: "10" });
      expect(errors.amount).toBeUndefined();
    });

    it("skips fee check when xlmBalance/feeXlm are defaulted", () => {
      const schema = createWithdrawFormSchema(100);
      const errors = validate(schema, { amount: "10" });
      expect(errors.amount).toBeUndefined();
    });
  });

  describe("valid withdrawals", () => {
    it("accepts valid withdrawal amount", () => {
      const schema = createWithdrawFormSchema(1000);
      const errors = validate(schema, { amount: "100" });
      expect(errors.amount).toBeUndefined();
    });

    it("accepts valid decimal withdrawal amount", () => {
      const schema = createWithdrawFormSchema(1000);
      const errors = validate(schema, { amount: "100.50" });
      expect(errors.amount).toBeUndefined();
    });

    it("accepts very small valid withdrawal amount", () => {
      const schema = createWithdrawFormSchema(1000);
      const errors = validate(schema, { amount: "0.01" });
      expect(errors.amount).toBeUndefined();
    });
  });
});
