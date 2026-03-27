import { subscribeToApiTelemetry } from "./api/telemetry";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  method?: string;
  url?: string;
  durationMs?: number;
  attempt?: number;
  status?: number;
  errorCode?: string;
  [key: string]: unknown;
}

export interface LoggerConfig {
  minLevel: LogLevel;
  output?: (entry: LogEntry) => void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_CONFIG: LoggerConfig = {
  minLevel: "info",
  output: (entry: LogEntry) => console.log(JSON.stringify(entry)),
};

let activeConfig: LoggerConfig = { ...DEFAULT_CONFIG };

export function configureLogger(config: LoggerConfig): void {
  activeConfig = config;
}

export function log(
  level: LogLevel,
  message: string,
  fields?: Partial<LogEntry>,
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[activeConfig.minLevel]) {
    return;
  }

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...fields,
  };

  const outputFn = activeConfig.output ?? DEFAULT_CONFIG.output!;

  try {
    outputFn(entry);
  } catch {
    console.error("logger: output function threw an error", entry);
  }
}

/**
 * Subscribes to the telemetry bus and maps each `ApiTelemetryEvent` variant
 * to a structured `LogEntry`, then calls `log()`.
 *
 * Returns an unsubscribe function so callers can tear down the subscription.
 */
export function setupLogging(): () => void {
  return subscribeToApiTelemetry((event) => {
    switch (event.type) {
      case "request":
        log("debug", "API request started", {
          correlationId: event.correlationId,
          method: event.method,
          url: event.url,
          attempt: event.attempt,
        });
        break;

      case "retry":
        log("warn", "API request retrying", {
          correlationId: event.correlationId,
          method: event.method,
          url: event.url,
          attempt: event.attempt,
        });
        break;

      case "success":
        log("info", "API request succeeded", {
          correlationId: event.correlationId,
          method: event.method,
          url: event.url,
          durationMs: event.durationMs,
          attempt: event.attempt,
          status: event.status,
        });
        break;

      case "error":
        log("error", "API request failed", {
          correlationId: event.correlationId,
          method: event.method,
          url: event.url,
          durationMs: event.durationMs,
          attempt: event.attempt,
          status: event.error.status,
          errorCode: event.error.code,
        });
        break;
    }
  });
}
