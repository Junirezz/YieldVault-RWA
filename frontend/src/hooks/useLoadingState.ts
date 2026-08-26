import { useState, useCallback, useEffect } from "react";

export type LoadingStatus = "idle" | "loading" | "success" | "error";

export interface UseLoadingStateOptions<T> {
  initialData?: T | null;
  minLoadingTimeMs?: number;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

export interface UseLoadingStateReturn<T> {
  status: LoadingStatus;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  data: T | null;
  error: Error | null;
  execute: (asyncFn: () => Promise<T>) => Promise<T | undefined>;
  setData: (data: T | null) => void;
  setError: (error: Error | null) => void;
  reset: () => void;
}

export function useLoadingState<T = any>(
  options: UseLoadingStateOptions<T> = {}
): UseLoadingStateReturn<T> {
  const { initialData = null, minLoadingTimeMs = 0, onSuccess, onError } = options;

  const [status, setStatus] = useState<LoadingStatus>(initialData !== null ? "success" : "idle");
  const [data, setData] = useState<T | null>(initialData);
  const [error, setErrorState] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setData(initialData);
    setErrorState(null);
  }, [initialData]);

  const execute = useCallback(
    async (asyncFn: () => Promise<T>): Promise<T | undefined> => {
      setStatus("loading");
      setErrorState(null);
      const startTime = Date.now();

      try {
        const result = await asyncFn();

        const elapsedTime = Date.now() - startTime;
        if (minLoadingTimeMs > 0 && elapsedTime < minLoadingTimeMs) {
          await new Promise((resolve) => setTimeout(resolve, minLoadingTimeMs - elapsedTime));
        }

        setData(result);
        setStatus("success");
        onSuccess?.(result);
        return result;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setErrorState(errorObj);
        setStatus("error");
        onError?.(errorObj);
        return undefined;
      }
    },
    [minLoadingTimeMs, onSuccess, onError]
  );

  return {
    status,
    isLoading: status === "loading",
    isSuccess: status === "success",
    isError: status === "error",
    data,
    error,
    execute,
    setData: (newData: T | null) => {
      setData(newData);
      if (newData !== null) setStatus("success");
    },
    setError: (newErr: Error | null) => {
      setErrorState(newErr);
      if (newErr !== null) setStatus("error");
    },
    reset,
  };
}

export default useLoadingState;
