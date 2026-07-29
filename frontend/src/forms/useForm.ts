import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FocusEvent, FormEvent } from "react";
import { type ValidationSchema, validate } from "./validate";

/**
 * Shared frontend form state hook with schema-based validation.
 *
 * - Validates a field on blur (marking it touched).
 * - Revalidates touched fields (or all fields, once a submit/validateAll has
 *   been attempted) as the user keeps typing, so errors clear/appear live
 *   instead of only on the next blur.
 * - `validateAll` runs the full schema, marks every field touched, and
 *   returns whether the values are valid — useful for gating navigation
 *   (e.g. moving to a "review" step) outside of a form `submit` event.
 */
export function useForm<T extends object>(
  initialValues: T,
  schema: ValidationSchema<T>,
) {
  const [values, setValuesState] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  // Refs mirror the latest state so callbacks built with useCallback (and
  // thus stable across renders) always read current values without needing
  // to be recreated on every keystroke. Event handlers below also write
  // through these refs synchronously (legal outside of render); the effect
  // is a safety net that keeps them in sync with state set by any other
  // path (notably `schema`, which is supplied fresh by the caller on every
  // render it changes).
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
      touchedMap: Partial<Record<keyof T, boolean>>,
    ): Partial<Record<keyof T, string>> =>
      Object.fromEntries(
        Object.entries(allErrors).filter(([field]) => touchedMap[field as keyof T]),
      ) as Partial<Record<keyof T, string>>,
    [],
  );

  /** Revalidate against the given values, respecting touched/attempted state. */
  const revalidate = useCallback(
    (nextValues: T) => {
      const nextErrors = validate(schemaRef.current, nextValues);
      if (hasAttemptedSubmitRef.current) {
        setErrors(nextErrors);
        return;
      }
      if (Object.keys(touchedRef.current).length > 0) {
        setErrors(filterTouchedErrors(nextErrors, touchedRef.current));
      }
    },
    [filterTouchedErrors],
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
    [revalidate],
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

      const nextErrors = validate(schemaRef.current, valuesRef.current);
      setErrors(
        hasAttemptedSubmitRef.current
          ? nextErrors
          : filterTouchedErrors(nextErrors, nextTouched),
      );
    },
    [filterTouchedErrors],
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
  }, []);

  /**
   * Validates every field in the schema, marks all of them touched, and
   * returns whether the values are valid. Pass `overrideValues` to validate
   * a value that hasn't been committed to state yet (avoids a stale read
   * caused by React state batching).
   */
  const validateAll = useCallback((overrideValues?: T): boolean => {
    const valuesToValidate = overrideValues ?? valuesRef.current;
    const nextErrors = validate(schemaRef.current, valuesToValidate);
    const touchedAll = Object.keys(schemaRef.current).reduce(
      (accumulator, field) => ({
        ...accumulator,
        [field]: true,
      }),
      {} as Partial<Record<keyof T, boolean>>,
    );

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
          return;
        }

        setIsSubmitting(true);
        try {
          await onSubmit(valuesRef.current);
        } finally {
          setIsSubmitting(false);
        }
      },
    [validateAll],
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
    [revalidate],
  );

  return {
    values,
    errors,
    touched,
    isSubmitting,
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
