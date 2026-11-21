import { describe, it, expect, vi } from "vitest";
import { mapServerError, mapTransactionError } from "./errorMappers";

describe("Error Mappers", () => {
  describe("mapTransactionError", () => {
    it("maps known numeric contract error codes", () => {
      const error = { serverCode: "2" };
      const result = mapTransactionError(error);
      expect(result.kind).toBe("insufficientShares");
      expect(result.retryable).toBe(false);
      expect(result.technicalCode).toBe("2");
    });

    it("maps known string contract error names", () => {
      const error = { code: "ContractPaused" };
      const result = mapTransactionError(error);
      expect(result.kind).toBe("contractPaused");
      expect(result.retryable).toBe(false);
      expect(result.technicalCode).toBe("ContractPaused");
    });

    it("maps user-cap errors correctly", () => {
      const error = { serverCode: "5" };
      const result = mapTransactionError(error);
      expect(result.kind).toBe("exceedsUserCap");
    });

    it("maps timelock errors correctly", () => {
      const error = { serverCode: "7" };
      const result = mapTransactionError(error);
      expect(result.kind).toBe("timelockActive");
    });

    it("falls back to regex for wallet rejections", () => {
      const error = { message: "User rejected the transaction" };
      const result = mapTransactionError(error);
      expect(result.kind).toBe("walletRejected");
      expect(result.retryable).toBe(true);
    });

    it("falls back to regex for network issues", () => {
      const error = { message: "Failed to fetch from RPC" };
      const result = mapTransactionError(error);
      expect(result.kind).toBe("network");
      expect(result.retryable).toBe(true);
    });

    it("categorizes unknown codes as 'unknown' and logs them", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = { serverCode: "999" };
      const result = mapTransactionError(error);
      
      expect(result.kind).toBe("unknown");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unmapped transaction error code: 999"),
        error
      );
      consoleSpy.mockRestore();
    });

    it("includes correlation IDs in the mapped result", () => {
      const error = { correlationId: "corr-123", serverCode: "4" };
      const result = mapTransactionError(error);
      expect(result.supportReference).toBe("corr-123");
    });
  });

  describe("mapServerError", () => {
    it("maps field-level errors from server response", () => {
      const error = {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: {
          field: "amount",
          message: "Amount exceeds vault capacity",
        },
      };

      const result = mapServerError(error);
      expect(result.fieldErrors).toHaveLength(1);
      expect(result.fieldErrors[0].fieldName).toBe("amount");
      expect(result.fieldErrors[0].message).toBe("Amount exceeds vault capacity");
      expect(result.generalError).toBeNull();
    });

    it("maps general errors from server response", () => {
      const error = {
        message: "Internal server error",
      };

      const result = mapServerError(error);
      expect(result.fieldErrors).toHaveLength(0);
      expect(result.generalError).toBe("Internal server error");
    });

    it("sanitizes error messages to remove stack traces", () => {
      const error = {
        message: "Something went wrong at line 123 at /path/to/file.ts",
      };

      const result = mapServerError(error);
      expect(result.generalError).not.toContain("at");
    });

    it("sanitizes error messages to remove database constraint info", () => {
      const error = {
        message: "Constraint violation: unique constraint vault_users_email",
      };

      const result = mapServerError(error);
      expect(result.generalError).not.toContain("constraint");
    });

    it("handles Error objects", () => {
      const error = new Error("Network timeout");

      const result = mapServerError(error);
      expect(result.generalError).toBe("Network timeout");
    });

    it("handles unknown error types", () => {
      const result = mapServerError(null);
      expect(result.generalError).toBe("An error occurred. Please try again.");
    });

    it("handles empty error messages", () => {
      const error = {
        message: "",
      };

      const result = mapServerError(error);
      expect(result.generalError).toBe("An error occurred. Please try again.");
    });

    it("truncates very long error messages", () => {
      const longMessage = "x".repeat(300);
      const error = {
        message: longMessage,
      };

      const result = mapServerError(error);
      expect(result.generalError?.length).toBeLessThanOrEqual(200);
    });
  });
});
