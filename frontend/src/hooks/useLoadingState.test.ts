import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLoadingState } from "./useLoadingState";

describe("useLoadingState Hook", () => {
  it("initializes with default options", () => {
    const { result } = renderHook(() => useLoadingState());
    expect(result.current.status).toBe("idle");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("handles successful execution", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useLoadingState({ onSuccess }));

    let res: string | undefined;
    await act(async () => {
      res = await result.current.execute(async () => "test-data");
    });

    expect(res).toBe("test-data");
    expect(result.current.status).toBe("success");
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.data).toBe("test-data");
    expect(onSuccess).toHaveBeenCalledWith("test-data");
  });

  it("handles failed execution", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useLoadingState({ onError }));

    await act(async () => {
      await result.current.execute(async () => {
        throw new Error("Failed request");
      });
    });

    expect(result.current.status).toBe("error");
    expect(result.current.isError).toBe(true);
    expect(result.current.error?.message).toBe("Failed request");
    expect(onError).toHaveBeenCalled();
  });

  it("resets state back to initial", async () => {
    const { result } = renderHook(() => useLoadingState({ initialData: null }));

    await act(async () => {
      await result.current.execute(async () => "some-data");
    });
    expect(result.current.data).toBe("some-data");

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeNull();
  });
});
