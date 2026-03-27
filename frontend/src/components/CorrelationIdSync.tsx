import { useEffect } from "react";
import { useCorrelationId } from "../context/CorrelationIdContext";
import { setCorrelationIdGetter } from "../lib/apiClient";

/**
 * Invisible component that keeps the shared API client's correlation ID
 * getter in sync with the current `CorrelationIdContext` value.
 *
 * Must be rendered inside `CorrelationIdProvider`.
 */
export function CorrelationIdSync() {
  const { correlationId } = useCorrelationId();

  useEffect(() => {
    setCorrelationIdGetter(() => correlationId);
  }, [correlationId]);

  return null;
}
