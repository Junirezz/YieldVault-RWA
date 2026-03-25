import type { ApiError } from "./error";

export type ApiTelemetryEvent =
  | {
      type: "request";
      method: string;
      url: string;
      attempt: number;
    }
  | {
      type: "retry";
      method: string;
      url: string;
      attempt: number;
      delayMs: number;
      reason: string;
    }
  | {
      type: "success";
      method: string;
      url: string;
      attempt: number;
      durationMs: number;
      status: number;
    }
  | {
      type: "error";
      method: string;
      url: string;
      attempt: number;
      durationMs: number;
      error: ApiError;
    };

type ApiTelemetryListener = (event: ApiTelemetryEvent) => void;

const listeners = new Set<ApiTelemetryListener>();

export function emitApiTelemetry(event: ApiTelemetryEvent) {
  listeners.forEach((listener) => listener(event));
}

export function subscribeToApiTelemetry(listener: ApiTelemetryListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
