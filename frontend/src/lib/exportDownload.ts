/**
 * Browser helpers for downloading text/binary artifacts via Blob URLs.
 */

export function escapeCsvValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildCsvFromRows(headers: string[], rows: string[][]): string {
  return [headers, ...rows]
    .map((columns) => columns.map((cell) => escapeCsvValue(String(cell ?? ""))).join(","))
    .join("\r\n");
}

export interface DownloadTextOptions {
  content: string;
  fileName: string;
  mimeType?: string;
}

/**
 * Triggers a file download for the given text payload.
 * Prefers Blob object URLs and falls back to a data URL when unavailable.
 */
export function downloadTextFile({
  content,
  fileName,
  mimeType = "text/plain;charset=utf-8",
}: DownloadTextOptions): void {
  const blob = new Blob([content], { type: mimeType });
  const url =
    typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(blob)
      : `data:${mimeType},${encodeURIComponent(content)}`;

  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName);
  // jsdom treats download clicks as navigations; keep them from escaping the test.
  link.addEventListener("click", (event) => {
    if (typeof event.preventDefault === "function") {
      event.preventDefault();
    }
  });
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  if (
    typeof URL !== "undefined" &&
    typeof URL.revokeObjectURL === "function" &&
    url.startsWith("blob:")
  ) {
    URL.revokeObjectURL(url);
  }
}
