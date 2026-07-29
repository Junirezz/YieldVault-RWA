import { describe, expect, it } from "vitest";
import {
  classifyWalletConnectionError,
  createWalletConnectionError,
  hasWalletConnectionError,
  initialWalletConnectionState,
  isWalletConnected,
  isWalletConnecting,
  reduceWalletConnection,
  walletErrorI18nKeys,
  type WalletConnectionState,
} from "./walletConnectionState";

describe("reduceWalletConnection", () => {
  it("starts disconnected with no error", () => {
    expect(initialWalletConnectionState).toEqual({
      status: "disconnected",
      address: null,
      error: null,
    });
  });

  it("moves disconnected → connecting on CONNECT_REQUESTED", () => {
    const next = reduceWalletConnection(initialWalletConnectionState, {
      type: "CONNECT_REQUESTED",
    });
    expect(next.status).toBe("connecting");
    expect(next.address).toBeNull();
    expect(next.error).toBeNull();
    expect(isWalletConnecting(next)).toBe(true);
  });

  it("ignores duplicate CONNECT_REQUESTED while already connecting", () => {
    const connecting: WalletConnectionState = {
      status: "connecting",
      address: null,
      error: null,
    };
    expect(
      reduceWalletConnection(connecting, { type: "CONNECT_REQUESTED" }),
    ).toBe(connecting);
  });

  it("moves connecting → connected on CONNECT_SUCCEEDED", () => {
    const connecting = reduceWalletConnection(initialWalletConnectionState, {
      type: "CONNECT_REQUESTED",
    });
    const next = reduceWalletConnection(connecting, {
      type: "CONNECT_SUCCEEDED",
      address: "GABC123",
    });
    expect(next).toEqual({
      status: "connected",
      address: "GABC123",
      error: null,
    });
    expect(isWalletConnected(next)).toBe(true);
  });

  it("moves connecting → error on CONNECT_FAILED with typed error", () => {
    const connecting = reduceWalletConnection(initialWalletConnectionState, {
      type: "CONNECT_REQUESTED",
    });
    const error = createWalletConnectionError(
      "NO_ADDRESS",
      "Freighter did not return a public key",
      true,
    );
    const next = reduceWalletConnection(connecting, {
      type: "CONNECT_FAILED",
      error,
    });
    expect(next.status).toBe("error");
    expect(next.address).toBeNull();
    expect(next.error).toEqual(error);
    expect(hasWalletConnectionError(next)).toBe(true);
  });

  it("clears session on DISCONNECT_REQUESTED", () => {
    const connected: WalletConnectionState = {
      status: "connected",
      address: "GABC123",
      error: null,
    };
    expect(
      reduceWalletConnection(connected, { type: "DISCONNECT_REQUESTED" }),
    ).toEqual(initialWalletConnectionState);
  });

  it("surfaces EXTERNAL_DISCONNECT as a clear retryable error", () => {
    const connected: WalletConnectionState = {
      status: "connected",
      address: "GABC123",
      error: null,
    };
    const next = reduceWalletConnection(connected, {
      type: "EXTERNAL_DISCONNECT",
    });
    expect(next.status).toBe("error");
    expect(next.address).toBeNull();
    expect(next.error?.code).toBe("DISCONNECTED_EXTERNALLY");
    expect(next.error?.retryable).toBe(true);
  });

  it("syncs an address discovered by polling into connected", () => {
    const next = reduceWalletConnection(initialWalletConnectionState, {
      type: "ADDRESS_SYNCED",
      address: "GSYNCED",
    });
    expect(isWalletConnected(next)).toBe(true);
    expect(next.address).toBe("GSYNCED");
  });

  it("RETRY from error returns to connecting and clears error", () => {
    const errored: WalletConnectionState = {
      status: "error",
      address: null,
      error: createWalletConnectionError("UNKNOWN", "boom", true),
    };
    const next = reduceWalletConnection(errored, { type: "RETRY" });
    expect(next.status).toBe("connecting");
    expect(next.error).toBeNull();
  });

  it("CLEAR_ERROR returns to disconnected", () => {
    const errored: WalletConnectionState = {
      status: "error",
      address: null,
      error: createWalletConnectionError("USER_REJECTED", "nope", true),
    };
    expect(
      reduceWalletConnection(errored, { type: "CLEAR_ERROR" }),
    ).toEqual(initialWalletConnectionState);
  });

  it("PARENT_ADDRESS_CLEARED preserves error but resets connected", () => {
    const errored: WalletConnectionState = {
      status: "error",
      address: null,
      error: createWalletConnectionError(
        "DISCONNECTED_EXTERNALLY",
        "gone",
        true,
      ),
    };
    expect(
      reduceWalletConnection(errored, { type: "PARENT_ADDRESS_CLEARED" }),
    ).toEqual(errored);

    const connected: WalletConnectionState = {
      status: "connected",
      address: "GABC",
      error: null,
    };
    expect(
      reduceWalletConnection(connected, { type: "PARENT_ADDRESS_CLEARED" }),
    ).toEqual(initialWalletConnectionState);
  });

  it("does not CLEAR_ERROR when not in error status", () => {
    const connected: WalletConnectionState = {
      status: "connected",
      address: "GABC",
      error: null,
    };
    expect(
      reduceWalletConnection(connected, { type: "CLEAR_ERROR" }),
    ).toBe(connected);
  });
});

describe("classifyWalletConnectionError", () => {
  it("detects missing Freighter extension", () => {
    expect(
      classifyWalletConnectionError(
        new Error("Freighter is not installed"),
      ).code,
    ).toBe("NOT_INSTALLED");
  });

  it("detects user rejection", () => {
    expect(
      classifyWalletConnectionError(new Error("User rejected the request"))
        .code,
    ).toBe("USER_REJECTED");
  });

  it("detects permission failures", () => {
    expect(
      classifyWalletConnectionError(new Error("Permission denied by wallet"))
        .code,
    ).toBe("PERMISSION_DENIED");
  });

  it("falls back to UNKNOWN", () => {
    const result = classifyWalletConnectionError(new Error("something else"));
    expect(result.code).toBe("UNKNOWN");
    expect(result.retryable).toBe(true);
  });

  it("accepts plain string errors", () => {
    expect(classifyWalletConnectionError("cancelled by user").code).toBe(
      "USER_REJECTED",
    );
  });
});

describe("walletErrorI18nKeys", () => {
  it("returns stable i18n paths for each error code", () => {
    expect(walletErrorI18nKeys("NO_ADDRESS")).toEqual({
      title: "wallet.status.error",
      description: "wallet.error.noAddress",
    });
  });
});
