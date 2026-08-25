/**
 * Explicit wallet connection state machine for Freighter / Stellar wallets.
 *
 * Statuses: disconnected → connecting → connected | error
 * Errors are typed so the UI can show clear, retryable feedback.
 */

export type WalletConnectionStatus =
  | "disconnected"
  | "connecting"
  | "retrying"
  | "connected"
  | "error";

export type WalletConnectionErrorCode =
  | "NOT_INSTALLED"
  | "PERMISSION_DENIED"
  | "USER_REJECTED"
  | "NO_ADDRESS"
  | "DISCONNECTED_EXTERNALLY"
  | "UNKNOWN";

export interface WalletConnectionError {
  code: WalletConnectionErrorCode;
  /** Developer-facing message (not necessarily user-facing copy). */
  message: string;
  retryable: boolean;
}

export interface WalletConnectionState {
  status: WalletConnectionStatus;
  address: string | null;
  error: WalletConnectionError | null;
  /** Number of retry attempts since last successful connect (reset to 0 on success). */
  retryCount: number;
}

export type WalletConnectionEvent =
  | { type: "CONNECT_REQUESTED" }
  | { type: "CONNECT_SUCCEEDED"; address: string }
  | { type: "CONNECT_FAILED"; error: WalletConnectionError }
  | { type: "DISCONNECT_REQUESTED" }
  | { type: "EXTERNAL_DISCONNECT" }
  | { type: "ADDRESS_SYNCED"; address: string }
  | { type: "CLEAR_ERROR" }
  | { type: "RETRY" }
  | { type: "RETRY_REQUESTED" }
  | { type: "PARENT_ADDRESS_CLEARED" };

export const initialWalletConnectionState: WalletConnectionState = {
  status: "disconnected",
  address: null,
  error: null,
  retryCount: 0,
};

const ERROR_I18N_KEYS: Record<
  WalletConnectionErrorCode,
  { title: string; description: string }
> = {
  NOT_INSTALLED: {
    title: "wallet.status.error",
    description: "wallet.error.notInstalled",
  },
  PERMISSION_DENIED: {
    title: "wallet.status.error",
    description: "wallet.error.notAllowed",
  },
  USER_REJECTED: {
    title: "wallet.status.error",
    description: "wallet.error.generic",
  },
  NO_ADDRESS: {
    title: "wallet.status.error",
    description: "wallet.error.noAddress",
  },
  DISCONNECTED_EXTERNALLY: {
    title: "toast.walletDisconnected.title",
    description: "wallet.tooltip.disconnectedStatus",
  },
  UNKNOWN: {
    title: "wallet.status.error",
    description: "wallet.error.generic",
  },
};

/** i18n key paths for a typed wallet connection error. */
export function walletErrorI18nKeys(code: WalletConnectionErrorCode): {
  title: string;
  description: string;
} {
  return ERROR_I18N_KEYS[code];
}

export function createWalletConnectionError(
  code: WalletConnectionErrorCode,
  message: string,
  retryable = true,
): WalletConnectionError {
  return { code, message, retryable };
}

/**
 * Map thrown Freighter / browser errors into typed connection errors.
 */
export function classifyWalletConnectionError(
  error: unknown,
): WalletConnectionError {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown wallet connection error";

  const lower = message.toLowerCase();

  if (
    lower.includes("freighter is not installed") ||
    lower.includes("not installed") ||
    lower.includes("not found") ||
    lower.includes("not detected") ||
    lower.includes("no freighter") ||
    lower.includes("cannot find module")
  ) {
    return createWalletConnectionError("NOT_INSTALLED", message, false);
  }

  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("rejected by user") ||
    lower.includes("cancelled") ||
    lower.includes("canceled")
  ) {
    return createWalletConnectionError("USER_REJECTED", message, true);
  }

  if (
    lower.includes("permission") ||
    lower.includes("not allowed") ||
    lower.includes("unauthorized")
  ) {
    return createWalletConnectionError("PERMISSION_DENIED", message, true);
  }

  return createWalletConnectionError("UNKNOWN", message, true);
}

/**
 * Pure reducer for wallet connection transitions.
 * Invalid events for the current status are no-ops (except ADDRESS_SYNCED / disconnect).
 */
export function reduceWalletConnection(
  state: WalletConnectionState,
  event: WalletConnectionEvent,
): WalletConnectionState {
  switch (event.type) {
    case "CONNECT_REQUESTED": {
      if (state.status === "connecting" || state.status === "retrying") {
        return state;
      }
      return {
        status: "connecting",
        address: null,
        error: null,
        retryCount: 0,
      };
    }

    case "RETRY_REQUESTED":
    case "RETRY": {
      if (state.status === "connecting" || state.status === "retrying") {
        return state;
      }
      if (
        state.status !== "error" &&
        state.status !== "disconnected"
      ) {
        return state;
      }
      return {
        status: "retrying",
        address: null,
        error: null,
        retryCount: state.retryCount + 1,
      };
    }

    case "CONNECT_SUCCEEDED":
    case "ADDRESS_SYNCED":
      return {
        status: "connected",
        address: event.address,
        error: null,
        retryCount: 0,
      };

    case "CONNECT_FAILED":
      return {
        status: "error",
        address: null,
        error: event.error,
        retryCount: state.retryCount,
      };

    case "DISCONNECT_REQUESTED":
      return {
        ...initialWalletConnectionState,
      };

    case "EXTERNAL_DISCONNECT":
      return {
        status: "error",
        address: null,
        error: createWalletConnectionError(
          "DISCONNECTED_EXTERNALLY",
          "Freighter is no longer connected to this session.",
          true,
        ),
        retryCount: state.retryCount,
      };

    case "CLEAR_ERROR":
      if (state.status !== "error") {
        return state;
      }
      return {
        ...initialWalletConnectionState,
      };

    case "PARENT_ADDRESS_CLEARED":
      // Keep a typed error so the user still sees why they were disconnected.
      if (state.status === "error") {
        return state;
      }
      // Do not interrupt an in-flight connect attempt.
      if (state.status === "connecting" || state.status === "retrying") {
        return state;
      }
      return {
        ...initialWalletConnectionState,
      };

    default:
      return state;
  }
}

export function isWalletConnecting(state: WalletConnectionState): boolean {
  return state.status === "connecting" || state.status === "retrying";
}

export function isWalletRetrying(state: WalletConnectionState): boolean {
  return state.status === "retrying";
}

export function isWalletConnected(state: WalletConnectionState): boolean {
  return state.status === "connected" && Boolean(state.address);
}

export function hasWalletConnectionError(
  state: WalletConnectionState,
): boolean {
  return state.status === "error" && state.error !== null;
}
