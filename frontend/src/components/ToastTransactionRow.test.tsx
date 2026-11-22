import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ToastTransactionRow, { type ToastNotifier } from "./ToastTransactionRow";
import { networkConfig, stellarExplorerBaseUrls } from "../config/network";

const VALID_HASH = "a".repeat(64);

function makeNotifier(): ToastNotifier & {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    success: vi.fn(() => "toast-success"),
    error: vi.fn(() => "toast-error"),
  };
}

function renderRow(txHash: string) {
  const notify = makeNotifier();
  const utils = render(<ToastTransactionRow txHash={txHash} notify={notify} />);
  return { ...utils, notify };
}

describe("ToastTransactionRow", () => {
  const originalIsTestnet = networkConfig.isTestnet;

  beforeEach(() => {
    networkConfig.isTestnet = true;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    networkConfig.isTestnet = originalIsTestnet;
    vi.restoreAllMocks();
  });

  it("shows a truncated hash, a copy control and a network-correct explorer link", () => {
    renderRow(VALID_HASH);

    const hash = screen.getByTitle(VALID_HASH);
    expect(hash).toHaveAttribute("data-tx-hash", VALID_HASH);
    // Truncated for display: first 8 characters, ellipsis, last 4.
    expect(hash).toHaveTextContent("aaaaaaaa...aaaa");

    expect(
      screen.getByRole("button", { name: "Copy transaction hash" }),
    ).toHaveAttribute("data-status", "idle");

    const link = screen.getByRole("link", {
      name: `View transaction ${VALID_HASH} on the Stellar explorer`,
    });
    // The base URL comes from config, not a hardcoded host.
    expect(link).toHaveAttribute(
      "href",
      `${stellarExplorerBaseUrls.testnet}/tx/${VALID_HASH}`,
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("follows the configured network when building the explorer link", () => {
    networkConfig.isTestnet = false;

    renderRow(VALID_HASH);

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `${stellarExplorerBaseUrls.mainnet}/tx/${VALID_HASH}`,
    );
  });

  it("copies the full hash and announces success", async () => {
    const { notify } = renderRow(VALID_HASH);

    fireEvent.click(screen.getByRole("button", { name: "Copy transaction hash" }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(VALID_HASH);
    });

    // The clipboard gets the whole hash, never the truncated display form.
    expect(navigator.clipboard.writeText).not.toHaveBeenCalledWith(
      "aaaaaaaa...aaaa",
    );

    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(notify.success).toHaveBeenCalledWith({
      title: "Transaction hash copied",
      description: "The full hash is ready to paste anywhere.",
      dedupeKey: "tx-hash-copy",
    });
  });

  it("announces failure when the clipboard rejects the copy", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });

    const { notify } = renderRow(VALID_HASH);

    fireEvent.click(screen.getByRole("button", { name: "Copy transaction hash" }));

    expect(await screen.findByText("Copy failed")).toBeInTheDocument();
    expect(notify.error).toHaveBeenCalledWith({
      title: "Unable to copy transaction hash",
      description:
        "Your browser blocked clipboard access. Use the explorer link to open the transaction instead.",
      dedupeKey: "tx-hash-copy",
    });
    expect(consoleError).toHaveBeenCalled();
  });

  it("renders nothing when the hash cannot be parsed", () => {
    const { container } = renderRow("not-a-valid-transaction-hash");

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the hash has the wrong length", () => {
    const { container } = renderRow("a".repeat(63));

    expect(container).toBeEmptyDOMElement();
  });
});
