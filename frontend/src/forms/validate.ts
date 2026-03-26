/**
 * Lightweight schema-based validator used by frontend forms.
 * This project currently has no dedicated validation library dependency,
 * so rules are defined via plain objects and validated in-repo.
 */
export type ValidationRule<TValues extends object> = {
  required?: boolean | string;
  min?: number;
  max?: number;
  pattern?: RegExp;
  custom?: (
    value: string,
    values: TValues,
  ) => string | undefined;
  messages?: {
    required?: string;
    min?: string;
    max?: string;
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
