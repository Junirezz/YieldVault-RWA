import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useForm } from "./useForm";
import { settingsFormSchema } from "./schemas/settingsFormSchema";
import { z } from "zod";

describe("Zod Form Validation & Submission States", () => {
  const initialValues = {
    username: "",
    email: "invalid-email",
    slippageTolerance: "10.0",
    currency: "USD" as const,
  };

  it("validates fields using Zod schema on validateAll", () => {
    const { result } = renderHook(() => useForm(initialValues, settingsFormSchema));

    let isValid = false;
    act(() => {
      isValid = result.current.validateAll();
    });

    expect(isValid).toBe(false);
    expect(result.current.errors.username).toBe("Username must be at least 3 characters.");
    expect(result.current.errors.email).toBe("Please enter a valid email address.");
    expect(result.current.errors.slippageTolerance).toBe("Slippage tolerance must be between 0.1% and 5.0%.");
  });

  it("clears field errors when valid data is entered", () => {
    const { result } = renderHook(() => useForm(initialValues, settingsFormSchema));

    act(() => {
      result.current.setValues({
        username: "valid_user",
        email: "user@example.com",
        slippageTolerance: "0.5",
        currency: "USD",
      });
    });

    let isValid = false;
    act(() => {
      isValid = result.current.validateAll();
    });

    expect(isValid).toBe(true);
    expect(result.current.errors).toEqual({});
  });

  it("tracks submission status (loading, success, error)", async () => {
    const validValues = {
      username: "valid_user",
      email: "user@example.com",
      slippageTolerance: "0.5",
      currency: "USD" as const,
    };

    const { result } = renderHook(() => useForm(validValues, settingsFormSchema));

    const onSubmitSuccess = vi.fn().mockResolvedValue(undefined);

    const fakeEvent = { preventDefault: vi.fn() } as any;

    await act(async () => {
      await result.current.handleSubmit(onSubmitSuccess)(fakeEvent);
    });

    expect(onSubmitSuccess).toHaveBeenCalledWith(validValues);
    expect(result.current.submitStatus).toBe("success");
    expect(result.current.isSubmitting).toBe(false);
  });
});
