import { useEffect } from "react";
import {
  subscribeToApiTelemetry,
  type ApiTelemetryEvent,
} from "./telemetry";

export function useApiTelemetry(handler: (event: ApiTelemetryEvent) => void) {
  useEffect(() => {
    return subscribeToApiTelemetry(handler);
  }, [handler]);
}
