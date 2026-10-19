/**
 * Issue #1624: the approval flow previously swallowed failures — the `catch`
 * branch was unreachable and the error never reached the caller. The hook now
 * exposes `isError`/`error` and rethrows so the UI can react.
 */
import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTokenAllowance } from "./useTokenAllowance";
import * as approvalApi from "../lib/approvalApi";

vi.mock("../lib/approvalApi", () => ({
  submitUsdcApproval: vi.fn(),
}));

const WALLET = "GABC123";

describe("useTokenAllowance error state (issue #1624)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts idle with no allowance and no error", () => {
    const { result } = renderHook(() => useTokenAllowance(WALLET));

    expect(result.current.allowance).toBe(0);
    expect(result.current.approvalStatus).toBe("idle");
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("confirms the approval on success", async () => {
    vi.mocked(approvalApi.submitUsdcApproval).mockResolvedValue(undefined);

    const { result } = renderHook(() => useTokenAllowance(WALLET));

    await act(async () => {
      await result.current.approve(100);
    });

    expect(approvalApi.submitUsdcApproval).toHaveBeenCalledWith(WALLET, 100);
    expect(result.current.approvalStatus).toBe("confirmed");
    expect(result.current.allowance).toBe(100);
    expect(result.current.isError).toBe(false);
  });

  it("exposes the error and rejects when approval fails", async () => {
    const failure = new Error("tx rejected by wallet");
    vi.mocked(approvalApi.submitUsdcApproval).mockRejectedValue(failure);

    const { result } = renderHook(() => useTokenAllowance(WALLET));

    await act(async () => {
      await expect(result.current.approve(100)).rejects.toBe(failure);
    });

    expect(result.current.approvalStatus).toBe("error");
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBe(failure);
    expect(result.current.allowance).toBe(0);
  });

  it("clears the error on resetApproval", async () => {
    vi.mocked(approvalApi.submitUsdcApproval).mockRejectedValue(new Error("nope"));

    const { result } = renderHook(() => useTokenAllowance(WALLET));

    await act(async () => {
      await result.current.approve(100).catch(() => undefined);
    });
    expect(result.current.isError).toBe(true);

    act(() => {
      result.current.resetApproval();
    });

    expect(result.current.approvalStatus).toBe("idle");
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("fails fast when there is no connected wallet", async () => {
    const { result } = renderHook(() => useTokenAllowance(null));

    await act(async () => {
      await expect(result.current.approve(100)).rejects.toThrow(/wallet/i);
    });

    expect(result.current.approvalStatus).toBe("error");
    expect(result.current.isError).toBe(true);
    expect(approvalApi.submitUsdcApproval).not.toHaveBeenCalled();
  });

  it("reports needsApproval only when allowance is insufficient", () => {
    const { result } = renderHook(() => useTokenAllowance(WALLET));

    expect(result.current.needsApproval(100)).toBe(true);
    expect(result.current.needsApproval(0)).toBe(false);
  });
});
