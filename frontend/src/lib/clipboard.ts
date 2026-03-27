export async function copyTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard support is unavailable in this environment.");
  }

  const fallbackInput = document.createElement("textarea");
  fallbackInput.value = text;
  fallbackInput.setAttribute("readonly", "");
  fallbackInput.setAttribute("aria-hidden", "true");
  fallbackInput.style.position = "fixed";
  fallbackInput.style.top = "0";
  fallbackInput.style.left = "0";
  fallbackInput.style.opacity = "0";

  document.body.appendChild(fallbackInput);
  fallbackInput.focus();
  fallbackInput.select();
  fallbackInput.setSelectionRange(0, fallbackInput.value.length);

  const wasCopied =
    typeof document.execCommand === "function" &&
    document.execCommand("copy");

  document.body.removeChild(fallbackInput);

  if (!wasCopied) {
    throw new Error("The browser rejected the clipboard copy request.");
  }
}
