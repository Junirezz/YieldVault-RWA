import { describe, expect, it } from "vitest";
import { validate, type ValidationSchema } from "./validate";

interface FormValues {
  name: string;
  code: string;
}

describe("validate", () => {
  const schema: ValidationSchema<FormValues> = {
    name: {
      required: "Name is required.",
      min: 3,
      max: 8,
      messages: {
        min: "Name too short.",
        max: "Name too long.",
      },
    },
    code: {
      pattern: /^[A-Z]{3}$/,
      messages: {
        pattern: "Code must be three uppercase letters.",
      },
      custom: (value) => (value === "BAD" ? "Code BAD is reserved." : undefined),
    },
  };

  it("fails when required field is missing", () => {
    const errors = validate(schema, { name: "", code: "ABC" });
    expect(errors.name).toBe("Name is required.");
  });

  it("fails min length and passes when min is met", () => {
    expect(validate(schema, { name: "Al", code: "ABC" }).name).toBe(
      "Name too short.",
    );
    expect(validate(schema, { name: "Alex", code: "ABC" }).name).toBeUndefined();
  });

  it("fails max length and passes when within max", () => {
    expect(validate(schema, { name: "Alexander", code: "ABC" }).name).toBe(
      "Name too long.",
    );
    expect(validate(schema, { name: "Alicia", code: "ABC" }).name).toBeUndefined();
  });

  it("fails pattern and passes matching pattern", () => {
    expect(validate(schema, { name: "Alice", code: "ab1" }).code).toBe(
      "Code must be three uppercase letters.",
    );
    expect(validate(schema, { name: "Alice", code: "USD" }).code).toBeUndefined();
  });

  it("runs custom validator", () => {
    expect(validate(schema, { name: "Alice", code: "BAD" }).code).toBe(
      "Code BAD is reserved.",
    );
  });
});
