import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FocusEvent, FormEvent } from "react";
import { type ValidationSchema, validate } from "./validate";
import { zodValidate } from "./zodValidate";
import { z } from "zod";

export type FormSchema<T extends object> = ValidationSchema<T> | z.ZodSchema<T>;
export type SubmitStatus = "idle" | "loading" | "success" | "error";

function runSchemaValidation<T extends object>(
  schema: FormSchema<T>,
  values: T
): Partial<Record<keyof T, string>> {
  if ("safeParse" in schema && typeof schema.safeParse === "function") {
    return zodValidate(schema as z.ZodSchema<T>, values);
  }
  return validate(schema as ValidationSchema<T>, values);
}

/**
 * Shared frontend form state hook with schema-based validation (Plain or Zod).
 */
export function useForm<T extends object>(
  initialValues: T,
  schema: FormSchema<T>
) {
  const [values, setValuesState] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const valuesRef = useRef(values);
  const touchedRef = useRef(touched);
  const schemaRef = useRef(schema);
  const hasAttemptedSubmitRef = useRef(hasAttemptedSubmit);

  useEffect(() => {
    valuesRef.current = values;
    touchedRef.current = touched;
    schemaRef.current = schema;
    hasAttemptedSubmitRef.current = hasAttemptedSubmit;
  });

  const filterTouchedErrors = useCallback(
    (
      allErrors: Partial<Record<keyof T, string>>,
      touchedMap: Partial<Record<keyof T, boolean>>
    ): Partial<Record<keyof T, string>> =>
      Object.fromEntries(
        Object.entries(allErrors).filter(([field]) => touchedMap[field as keyof T])
      ) as Partial<Record<keyof T, string>>,
    []
  );

  const revalidate = useCallback(
    (nextValues: T) => {
      const nextErrors = runSchemaValidation(schemaRef.current, nextValues);
      if (hasAttemptedSubmitRef.current) {
        setErrors(nextErrors);
        return;
      }
      if (Object.keys(touchedRef.current).length > 0) {
        setErrors(filterTouchedErrors(nextErrors, touchedRef.current));
      }
    },
    [filterTouchedErrors]
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const { name, value } = event.target;
      const key = name as keyof T;

      const nextValues = {
        ...valuesRef.current,
        [key]: value,
      };
      valuesRef.current = nextValues;
      setValuesState(nextValues);
      revalidate(nextValues);
    },
    [revalidate]
  );

  const handleBlur = useCallback(
    (event: FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const { name } = event.target;
      const key = name as keyof T;

      const nextTouched = {
        ...touchedRef.current,
        [key]: true,
      };
      touchedRef.current = nextTouched;
      setTouched(nextTouched);

      const nextErrors = runSchemaValidation(schemaRef.current, valuesRef.current);
      setErrors(
        hasAttemptedSubmitRef.current
          ? nextErrors
          : filterTouchedErrors(nextErrors, nextTouched)
      );
    },
    [filterTouchedErrors]
  );

  const setFieldError = useCallback((name: keyof T, error: string) => {
    setErrors((previous) => ({
      ...previous,
      [name]: error,
    }));
    setTouched((previous) => {
      const next = { ...previous, [name]: true };
      touchedRef.current = next;
      return next;
    });
  }, []);

  const resetErrors = useCallback(() => {
    setErrors({});
    setTouched({});
    touchedRef.current = {};
    setHasAttemptedSubmit(false);
    hasAttemptedSubmitRef.current = false;
    setSubmitStatus("idle");
    setSubmitError(null);
  }, []);

  const validateAll = useCallback((overrideValues?: T): boolean => {
    const valuesToValidate = overrideValues ?? valuesRef.current;
    const nextErrors = runSchemaValidation(schemaRef.current, valuesToValidate);

    let touchedAll: Partial<Record<keyof T, boolean>> = {};
    if ("shape" in schemaRef.current && typeof (schemaRef.current as any).shape === "object") {
      const shape = (schemaRef.current as any).shape;
      Object.keys(shape).forEach((key) => {
        touchedAll[key as keyof T] = true;
      });
    } else {
      Object.keys(schemaRef.current).forEach((key) => {
        touchedAll[key as keyof T] = true;
      });
    }

    const nextTouched = { ...touchedRef.current, ...touchedAll };
    touchedRef.current = nextTouched;
    setTouched(nextTouched);
    setErrors(nextErrors);
    setHasAttemptedSubmit(true);
    hasAttemptedSubmitRef.current = true;

    return Object.keys(nextErrors).length === 0;
  }, []);

  const handleSubmit = useCallback(
    (onSubmit: (formValues: T) => Promise<void>) =>
      async (event: FormEvent) => {
        event.preventDefault();

        if (!validateAll()) {
          setSubmitStatus("error");
          return;
        }

        setIsSubmitting(true);
        setSubmitStatus("loading");
        setSubmitError(null);

        try {
          await onSubmit(valuesRef.current);
          setSubmitStatus("success");
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          setSubmitStatus("error");
          setSubmitError(errMsg);
        } finally {
          setIsSubmitting(false);
        }
      },
    [validateAll]
  );

  const setValues = useCallback(
    (nextValues: T | ((previous: T) => T)) => {
      const resolved =
        typeof nextValues === "function"
          ? (nextValues as (previous: T) => T)(valuesRef.current)
          : nextValues;

      valuesRef.current = resolved;
      setValuesState(resolved);
      revalidate(resolved);
    },
    [revalidate]
  );

  return {
    values,
    errors,
    touched,
    isSubmitting,
    submitStatus,
    submitError,
    hasAttemptedSubmit,
    handleChange,
    handleBlur,
    handleSubmit,
    setFieldError,
    setValues,
    resetErrors,
    validateAll,
  };
}

export default useForm;
