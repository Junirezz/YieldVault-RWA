import { useState } from "react";
import type { ChangeEvent, FocusEvent, FormEvent } from "react";
import { type ValidationSchema, validate } from "./validate";

/**
 * Shared frontend form state hook with schema-based validation.
 * Validates per-field on blur and all fields on submit.
 */
export function useForm<T extends object>(
  initialValues: T,
  schema: ValidationSchema<T>,
) {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (event: ChangeEvent<any>) => {
    const { name, value } = event.target;
    const key = name as keyof T;

    setValues((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  const handleBlur = (event: FocusEvent<any>) => {
    const { name } = event.target;
    const key = name as keyof T;

    const nextTouched = {
      ...touched,
      [key]: true,
    };
    setTouched(nextTouched);

    const nextErrors = validate(schema, values);
    const filteredErrors = Object.fromEntries(
      Object.entries(nextErrors).filter(([field]) => nextTouched[field as keyof T]),
    ) as Partial<Record<keyof T, string>>;
    setErrors(filteredErrors);
  };

  const setFieldError = (name: keyof T, error: string) => {
    setErrors((previous) => ({
      ...previous,
      [name]: error,
    }));
    setTouched((previous) => ({
      ...previous,
      [name]: true,
    }));
  };

  const handleSubmit =
    (onSubmit: (formValues: T) => Promise<void>) =>
    async (event: FormEvent) => {
      event.preventDefault();

      const nextErrors = validate(schema, values);
      const touchedAll = Object.keys(schema).reduce(
        (accumulator, field) => ({
          ...accumulator,
          [field]: true,
        }),
        {} as Partial<Record<keyof T, boolean>>,
      );

      setTouched((previous) => ({
        ...previous,
        ...touchedAll,
      }));
      setErrors(nextErrors);

      if (Object.keys(nextErrors).length > 0) {
        return;
      }

      setIsSubmitting(true);
      try {
        await onSubmit(values);
      } finally {
        setIsSubmitting(false);
      }
    };

  return {
    values,
    errors,
    touched,
    isSubmitting,
    handleChange,
    handleBlur,
    handleSubmit,
    setFieldError,
  };
}
