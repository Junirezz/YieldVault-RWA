import { useEffect, useMemo, useState, type ReactNode } from "react";

export type AsyncActionStatus = "idle" | "pending" | "success" | "error";

export interface AsyncActionLabels {
  idle: ReactNode;
  pending?: ReactNode;
  success?: ReactNode;
  error?: ReactNode;
}

export interface UseAsyncActionButtonOptions {
  labels: AsyncActionLabels;
  isPending?: boolean;
  isSuccess?: boolean;
  isError?: boolean;
  successResetMs?: number;
  errorResetMs?: number;
}

export interface AsyncActionButtonState {
  status: AsyncActionStatus;
  label: ReactNode;
  isDisabled: boolean;
  reset: () => void;
}

/**
 * Maps async wallet/mutation state to standardized button status and labels.
 */
export function useAsyncActionButton({
  labels,
  isPending = false,
  isSuccess = false,
  isError = false,
  successResetMs = 2000,
  errorResetMs = 3000,
}: UseAsyncActionButtonOptions): AsyncActionButtonState {
  const [status, setStatus] = useState<AsyncActionStatus>("idle");

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- mirror external async flags into button status */
    if (isPending) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- maps external async flags into button chrome
      // Sync button chrome with mutation status flags from the caller.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derived UI status from external flags
      setStatus("pending");
      return;
    }
    if (isSuccess) {
      setStatus("success");
      const timer = window.setTimeout(() => setStatus("idle"), successResetMs);
      return () => window.clearTimeout(timer);
    }
    if (isError) {
      setStatus("error");
      const timer = window.setTimeout(() => setStatus("idle"), errorResetMs);
      return () => window.clearTimeout(timer);
    }
    if (!isPending && !isSuccess && !isError) {
      setStatus("idle");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isPending, isSuccess, isError, successResetMs, errorResetMs]);

  const label = useMemo(() => {
    switch (status) {
      case "pending":
        return labels.pending ?? labels.idle;
      case "success":
        return labels.success ?? labels.idle;
      case "error":
        return labels.error ?? labels.idle;
      default:
        return labels.idle;
    }
  }, [labels, status]);

  return {
    status,
    label,
    isDisabled: status === "pending",
    reset: () => setStatus("idle"),
  };
}
