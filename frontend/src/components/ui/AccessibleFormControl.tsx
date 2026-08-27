import React, { useId } from "react";

interface AccessibleFormControlProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  direction?: "row" | "column";
}

const AccessibleFormControl: React.FC<AccessibleFormControlProps> = ({
  label,
  htmlFor,
  hint,
  required = false,
  error,
  children,
  direction = "column",
}) => {
  const autoId = useId();
  const inputId = htmlFor || autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  const ariaDescribedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: direction === "column" ? "column" : "row",
        alignItems: direction === "row" ? "center" : "stretch",
        gap: direction === "row" ? "12px" : "6px",
      }}
    >
      <label
        htmlFor={inputId}
        style={{
          fontSize: "0.9rem",
          fontWeight: 600,
          color: error ? "var(--text-error)" : "var(--text-primary)",
          whiteSpace: direction === "row" ? "nowrap" : undefined,
        }}
      >
        {label}
        {required && (
          <span
            aria-hidden="true"
            style={{ color: "var(--text-error)", marginLeft: "4px" }}
          >
            *
          </span>
        )}
      </label>

      {hint && (
        <span
          id={hintId}
          style={{
            fontSize: "0.8rem",
            color: "var(--text-secondary)",
            marginTop: direction === "column" ? "-2px" : undefined,
          }}
        >
          {hint}
        </span>
      )}

      <div
        style={{
          flex: direction === "row" ? 1 : undefined,
        }}
        aria-describedby={ariaDescribedBy}
        aria-invalid={!!error}
        aria-required={required}
      >
        {children}
      </div>

      {error && (
        <span
          id={errorId}
          role="alert"
          style={{
            fontSize: "0.8rem",
            color: "#ef4444",
            marginTop: direction === "column" ? "-2px" : undefined,
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
};

export default AccessibleFormControl;
