import type React from "react";

export interface FormFieldProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  error?: string;
  helperText?: string;
}

const FormField: React.FC<FormFieldProps> = ({
  label,
  name,
  error,
  helperText,
  disabled,
  type = "text",
  id,
  className,
  ...props
}) => {
  const inputId = id ?? name;
  const errorId = `${name}-error`;
  const helperId = `${name}-helper`;

  return (
    <div className="form-control">
      <label className="form-label" htmlFor={inputId}>{label}</label>
      <div className={`input-wrapper ${error ? "input-wrapper-error" : ""} ${className ?? ""}`.trim()}>
        <input
          {...props}
          id={inputId}
          type={type}
          name={name}
          className="input-field"
          disabled={disabled}
          aria-invalid={error ? "true" : undefined}
          aria-errormessage={error ? errorId : undefined}
          aria-describedby={
            [error ? errorId : undefined, helperText ? helperId : undefined]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
      </div>
      {error ? (
        <span id={errorId} className="form-error" role="alert">
          {error}
        </span>
      ) : helperText ? (
        <span id={helperId} className="form-helper">
          {helperText}
        </span>
      ) : null}
    </div>
  );
};

export default FormField;
