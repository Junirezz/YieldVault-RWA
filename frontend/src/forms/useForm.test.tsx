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
});
