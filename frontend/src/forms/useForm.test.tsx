import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useForm } from "./useForm";

interface UseFormValues {
  amount: string;
}

describe("useForm", () => {
  const schema = {
    amount: {
      required: "Amount is required.",
      custom: (value: string) =>
        Number(value) > 0 ? undefined : "Amount must be positive.",
    },
  };

  it("returns initial state", () => {
    const { result } = renderHook(() => useForm<UseFormValues>({ amount: "" }, schema));
    expect(result.current.values).toEqual({ amount: "" });
    expect(result.current.errors).toEqual({});
    expect(result.current.touched).toEqual({});
    expect(result.current.isSubmitting).toBe(false);
  });

  it("handleChange updates values", () => {
    const { result } = renderHook(() => useForm<UseFormValues>({ amount: "" }, schema));

    act(() => {
      result.current.handleChange({
        target: { name: "amount", value: "12" },
      } as never);
    });

    expect(result.current.values.amount).toBe("12");
  });

  it("handleBlur marks touched and validates field", () => {
    const { result } = renderHook(() => useForm<UseFormValues>({ amount: "" }, schema));

    act(() => {
      result.current.handleBlur({
        target: { name: "amount" },
      } as never);
    });

    expect(result.current.touched.amount).toBe(true);
    expect(result.current.errors.amount).toBe("Amount is required.");
  });

  it("handleSubmit validates all fields and blocks submit when invalid", async () => {
    const { result } = renderHook(() => useForm<UseFormValues>({ amount: "" }, schema));
    const onSubmit = vi.fn<() => Promise<void>>().mockResolvedValue();

    await act(async () => {
      await result.current.handleSubmit(onSubmit)({ preventDefault() {} } as never);
    });

    expect(result.current.errors.amount).toBe("Amount is required.");
    expect(result.current.touched.amount).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("tracks isSubmitting lifecycle for valid submit", async () => {
    const { result } = renderHook(() =>
      useForm<UseFormValues>({ amount: "15" }, schema),
    );

    let resolveSubmit: (() => void) | undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );

    act(() => {
      void result.current.handleSubmit(onSubmit)({ preventDefault() {} } as never);
    });

    await waitFor(() => {
      expect(result.current.isSubmitting).toBe(true);
    });

    await act(async () => {
      resolveSubmit?.();
    });

    expect(result.current.isSubmitting).toBe(false);
  });

  it("setFieldError stores server-side error", () => {
    const { result } = renderHook(() => useForm<UseFormValues>({ amount: "" }, schema));

    act(() => {
      result.current.setFieldError("amount", "Insufficient balance.");
    });

    expect(result.current.errors.amount).toBe("Insufficient balance.");
    expect(result.current.touched.amount).toBe(true);
  });

  it("does not show errors for untouched fields while typing", () => {
    const { result } = renderHook(() => useForm<UseFormValues>({ amount: "" }, schema));

    act(() => {
      result.current.handleChange({
        target: { name: "amount", value: "-5" },
      } as never);
    });

    expect(result.current.errors.amount).toBeUndefined();
  });

  it("revalidates a touched field as the user keeps typing", () => {
    const { result } = renderHook(() => useForm<UseFormValues>({ amount: "" }, schema));

    act(() => {
      result.current.handleBlur({
        target: { name: "amount" },
      } as never);
    });
    expect(result.current.errors.amount).toBe("Amount is required.");

    act(() => {
      result.current.handleChange({
        target: { name: "amount", value: "-5" },
      } as never);
    });
    expect(result.current.errors.amount).toBe("Amount must be positive.");

    act(() => {
      result.current.handleChange({
        target: { name: "amount", value: "5" },
      } as never);
    });
    expect(result.current.errors.amount).toBeUndefined();
  });

  it("hasAttemptedSubmit starts false and flips to true after validateAll", () => {
    const { result } = renderHook(() => useForm<UseFormValues>({ amount: "" }, schema));

    expect(result.current.hasAttemptedSubmit).toBe(false);

    act(() => {
      result.current.validateAll();
    });

    expect(result.current.hasAttemptedSubmit).toBe(true);
  });

  it("validateAll marks all fields touched and returns validity", () => {
    const { result } = renderHook(() => useForm<UseFormValues>({ amount: "" }, schema));

    let isValid = true;
    act(() => {
      isValid = result.current.validateAll();
    });

    expect(isValid).toBe(false);
    expect(result.current.touched.amount).toBe(true);
    expect(result.current.errors.amount).toBe("Amount is required.");
  });

  it("validateAll accepts override values to avoid stale reads", () => {
    const { result } = renderHook(() => useForm<UseFormValues>({ amount: "" }, schema));

    let isValid = false;
    act(() => {
      isValid = result.current.validateAll({ amount: "10" });
    });

    expect(isValid).toBe(true);
    expect(result.current.errors.amount).toBeUndefined();
    expect(result.current.touched.amount).toBe(true);
  });

  it("revalidates once a submit has been attempted, even for untouched fields", () => {
    const { result } = renderHook(() =>
      useForm<UseFormValues>({ amount: "10" }, schema),
    );

    act(() => {
      result.current.validateAll();
    });
    expect(result.current.errors.amount).toBeUndefined();

    act(() => {
      result.current.setValues({ amount: "-1" });
    });
    expect(result.current.errors.amount).toBe("Amount must be positive.");
  });

  it("resetErrors clears hasAttemptedSubmit", () => {
    const { result } = renderHook(() => useForm<UseFormValues>({ amount: "" }, schema));

    act(() => {
      result.current.validateAll();
    });
    expect(result.current.hasAttemptedSubmit).toBe(true);

    act(() => {
      result.current.resetErrors();
    });

    expect(result.current.hasAttemptedSubmit).toBe(false);
    expect(result.current.errors).toEqual({});
    expect(result.current.touched).toEqual({});
  });

  it("setValues revalidates touched fields", () => {
    const { result } = renderHook(() => useForm<UseFormValues>({ amount: "" }, schema));

    act(() => {
      result.current.handleBlur({
        target: { name: "amount" },
      } as never);
    });
    expect(result.current.errors.amount).toBe("Amount is required.");

    act(() => {
      result.current.setValues({ amount: "42" });
    });

    expect(result.current.values.amount).toBe("42");
    expect(result.current.errors.amount).toBeUndefined();
  });
});
