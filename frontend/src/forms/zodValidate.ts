import { z } from "zod";

/**
 * Validates form values using a Zod schema.
 * Returns a map of fieldName -> first error message string.
 */
export function zodValidate<TValues extends object>(
  schema: z.ZodSchema<TValues>,
  values: TValues
): Partial<Record<keyof TValues, string>> {
  const result = schema.safeParse(values);
  if (result.success) {
    return {};
  }

  const errors: Partial<Record<keyof TValues, string>> = {};
  for (const issue of result.error.issues) {
    const fieldName = issue.path[0] as keyof TValues;
    if (fieldName && !errors[fieldName]) {
      errors[fieldName] = issue.message;
    }
  }

  return errors;
}

export default zodValidate;
