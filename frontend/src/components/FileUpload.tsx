import { useState, useRef, useCallback, type ChangeEvent, type DragEvent } from "react";
import { Upload, X, CheckCircle, AlertCircle, File as FileIcon } from "lucide-react";

interface FileValidation {
  /** Maximum file size in bytes (default: 10 MB) */
  maxSize?: number;
  /** Allowed MIME types or extensions, e.g. ["image/png", "application/pdf"] */
  accept?: string[];
}

interface UploadFile {
  id: string;
  file: File;
  progress: number; // 0-100
  status: "pending" | "uploading" | "success" | "error";
  errorMessage?: string;
}

interface FileUploadProps {
  validation?: FileValidation;
  /** Simulated upload duration in ms (for demo; replace with real API call) */
  uploadDuration?: number;
  /** Called when a file completes upload successfully */
  onUploadComplete?: (file: File) => void;
  className?: string;
}

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10 MB

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

function validateFile(file: File, rules: FileValidation): string | null {
  const maxSize = rules.maxSize ?? DEFAULT_MAX_SIZE;
  if (file.size > maxSize) {
    return `File exceeds ${formatBytes(maxSize)} limit (${formatBytes(file.size)})`;
  }
  if (rules.accept && rules.accept.length > 0) {
    const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
    const mime = file.type.toLowerCase();
    const matches = rules.accept.some(
      (a) =>
        a.toLowerCase() === mime ||
        a.toLowerCase() === ext ||
        (a.startsWith(".") && a.toLowerCase() === ext)
    );
    if (!matches) {
      return `File type not allowed. Accepted: ${rules.accept.join(", ")}`;
    }
  }
  return null;
}

/**
 * Robust file upload component with drag/drop, click, progress, validation, retry, and cancel.
 */
export function FileUpload({
  validation = {},
  uploadDuration = 2000,
  onUploadComplete,
  className,
}: FileUploadProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileIdCounter = useRef(0);

  const simulateUpload = useCallback(
    (uploadFile: UploadFile) => {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadFile.id ? { ...f, status: "uploading" as const } : f
        )
      );

      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 15 + 5;
        if (progress >= 100) {
          clearInterval(interval);
          progress = 100;
          setFiles((prev) =>
            prev.map((f) =>
              f.id === uploadFile.id
                ? { ...f, progress: 100, status: "success" as const }
                : f
            )
          );
          onUploadComplete?.(uploadFile.file);
        } else {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === uploadFile.id ? { ...f, progress: Math.round(progress) } : f
            )
          );
        }
      }, uploadDuration / 10);

      return interval;
    },
    [uploadDuration, onUploadComplete]
  );

  const addFiles = useCallback(
    (incoming: File[]) => {
      const newUploadFiles: UploadFile[] = [];
      incoming.forEach((file) => {
        const error = validateFile(file, validation);
        const id = `file-${++fileIdCounter.current}`;
        newUploadFiles.push({
          id,
          file,
          progress: 0,
          status: error ? "error" : "pending",
          errorMessage: error ?? undefined,
        });
      });

      setFiles((prev) => [...prev, ...newUploadFiles]);

      // Auto-upload valid files
      newUploadFiles
        .filter((uf) => uf.status === "pending")
        .forEach((uf) => simulateUpload(uf));
    },
    [validation, simulateUpload]
  );

  const retry = useCallback(
    (id: string) => {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? { ...f, status: "pending" as const, progress: 0, errorMessage: undefined }
            : f
        )
      );
      const file = files.find((f) => f.id === id);
      if (file) simulateUpload(file);
    },
    [files, simulateUpload]
  );

  const cancel = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length > 0) addFiles(dropped);
    },
    [addFiles]
  );

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(e.target.files ?? []);
      if (selected.length > 0) addFiles(selected);
      if (inputRef.current) inputRef.current.value = "";
    },
    [addFiles]
  );

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload files"
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          padding: "40px 24px",
          minHeight: "160px",
          border: `2px dashed ${isDragging ? "var(--accent-cyan)" : "var(--border-glass)"}`,
          borderRadius: "var(--radius-lg)",
          background: isDragging ? "var(--accent-cyan-dim)" : "var(--bg-surface)",
          cursor: "pointer",
          transition: "all 0.2s ease",
          color: "var(--text-secondary)",
          textAlign: "center",
        }}
      >
        <Upload size={32} style={{ color: isDragging ? "var(--accent-cyan)" : "var(--text-tertiary)" }} />
        <div>
          <strong style={{ color: "var(--text-primary)" }}>Drop files here</strong> or click to browse
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
          Max {formatBytes(validation.maxSize ?? DEFAULT_MAX_SIZE)}
          {validation.accept ? ` · ${validation.accept.join(", ")}` : ""}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={validation.accept?.join(",")}
          onChange={handleInputChange}
          style={{ display: "none" }}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {files.map((uf) => (
            <div
              key={uf.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "12px 16px",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-glass)",
              }}
            >
              <FileIcon size={20} aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-tertiary)" }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {uf.file.name}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                  {formatBytes(uf.file.size)}
                </div>

                {/* Progress bar */}
                {uf.status === "uploading" && (
                  <div
                    role="progressbar"
                    aria-valuenow={uf.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Uploading ${uf.file.name}: ${uf.progress}%`}
                    style={{ marginTop: "8px", height: "4px", background: "var(--bg-muted)", borderRadius: "2px", overflow: "hidden" }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${uf.progress}%`,
                        background: "var(--accent-cyan)",
                        borderRadius: "2px",
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                )}

                {/* Error message */}
                {uf.status === "error" && (
                  <div style={{ marginTop: "4px", fontSize: "var(--text-xs)", color: "var(--text-error)" }}>
                    {uf.errorMessage}
                  </div>
                )}
              </div>

              {/* Status / actions */}
              {uf.status === "uploading" && (
                <span style={{ fontSize: "var(--text-sm)", color: "var(--accent-cyan)", fontWeight: 600, minWidth: "40px", textAlign: "right" }}>
                  {uf.progress}%
                </span>
              )}
              {uf.status === "success" && (
                <CheckCircle size={20} style={{ color: "#22c55e", flexShrink: 0 }} />
              )}
              {uf.status === "error" && (
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => retry(uf.id)}
                    aria-label={`Retry ${uf.file.name}`}
                    style={{
                      padding: "6px 12px",
                      fontSize: "var(--text-xs)",
                      fontWeight: 600,
                      borderRadius: "var(--radius-sm)",
                      background: "var(--accent-cyan-dim)",
                      color: "var(--accent-cyan)",
                      border: "1px solid var(--border-glass-glow)",
                      cursor: "pointer",
                      minHeight: "36px",
                    }}
                  >
                    Retry
                  </button>
                  <AlertCircle size={20} style={{ color: "var(--text-error)", flexShrink: 0 }} />
                </div>
              )}
              {uf.status === "pending" && (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Queued</span>
              )}

              {/* Cancel button */}
              <button
                type="button"
                onClick={() => cancel(uf.id)}
                aria-label={`Remove ${uf.file.name}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-tertiary)",
                  flexShrink: 0,
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-error)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-tertiary)")}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default FileUpload;