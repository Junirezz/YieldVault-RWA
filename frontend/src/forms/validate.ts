/**
 * Lightweight schema-based validator used by frontend forms.
 *
 * The API layer (`packages/api-schemas`) validates requests with Zod, but
 * that runtime isn't pulled into these forms — rules here are plain objects
 * validated in-repo so fields can be checked on every keystroke without the
 * overhead of parsing a Zod schema. Where a rule mirrors a server-side
 * constraint (notably amount formatting, see
 * `forms/schemas/amountValidation.ts`), it is kept in sync with the
 * corresponding Zod schema so a value accepted here will not be rejected by
 * the API, and vice versa.
 */
export type ValidationRule<TValues extends object> = {
  required?: boolean | string;
  min?: number;
  max?: number;
  minVal?: number;
  maxVal?: number;
  pattern?: RegExp;
  custom?: (
    value: string,
    values: TValues,
  ) => string | undefined;
  messages?: {
    required?: string;
    min?: string;
    max?: string;
    minVal?: string;
    maxVal?: string;
    pattern?: string;
  };
};

export type ValidationSchema<TValues extends object> = {
  [K in keyof TValues]?: ValidationRule<TValues>;
};

const toComparableString = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
};

/**
 * Validates field values against a plain-object schema.
 * Returns a map of fieldName -> first failing error message.
 */
export function validate<TValues extends object>(
  schema: ValidationSchema<TValues>,
  values: TValues,
): Partial<Record<keyof TValues, string>> {
  const errors: Partial<Record<keyof TValues, string>> = {};

  (Object.keys(schema) as Array<keyof TValues>).forEach((field) => {
    const rule = schema[field];
    if (!rule) {
      return;
    }

    const rawValue = values[field as keyof TValues];
    const value = toComparableString(rawValue).trim();

    const requiredMessage =
      typeof rule.required === "string"
        ? rule.required
        : rule.messages?.required ?? "This field is required.";

    if (rule.required && value.length === 0) {
      errors[field] = requiredMessage;
      return;
    }

    if (!value.length) {
      return;
    }

    if (rule.min !== undefined && value.length < rule.min) {
      errors[field] =
        rule.messages?.min ?? `Must be at least ${rule.min} characters.`;
      return;
    }

    if (rule.max !== undefined && value.length > rule.max) {
      errors[field] =
        rule.messages?.max ?? `Must be at most ${rule.max} characters.`;
      return;
    }

    const numValue = Number(value);
    const isNumeric = !isNaN(numValue) && value.length > 0;

    if (rule.minVal !== undefined) {
      if (!isNumeric || numValue < rule.minVal) {
        errors[field] =
          rule.messages?.minVal ?? `Value must be at least ${rule.minVal}.`;
        return;
      }
    }

    if (rule.maxVal !== undefined) {
      if (!isNumeric || numValue > rule.maxVal) {
        errors[field] =
          rule.messages?.maxVal ?? `Value must be at most ${rule.maxVal}.`;
        return;
      }
    }

    if (rule.pattern && !rule.pattern.test(value)) {
      errors[field] = rule.messages?.pattern ?? "Invalid format.";
      return;
    }

    if (rule.custom) {
      const customError = rule.custom(value, values);
      if (customError) {
        errors[field] = customError;
      }
    }
  });

  return errors;
}
