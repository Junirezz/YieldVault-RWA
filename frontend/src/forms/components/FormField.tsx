import type React from "react";

export interface FormFieldProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  error?: string;
}

const FormField: React.FC<FormFieldProps> = ({
  label,
  name,
  error,
  disabled,
  type = "text",
  id,
  ...props
}) => {
  const inputId = id ?? name;
  const errorId = `${name}-error`;

  return (
    <div className="form-control">
      <label className="form-label" htmlFor={inputId}>{label}</label>
      <div className={`input-wrapper ${error ? "input-wrapper-error" : ""}`}>
        <input
          {...props}
          id={inputId}
          type={type}
          name={name}
          className={`input-field ${props.className ?? ""}`.trim()}
          disabled={disabled}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </div>
      {error ? (
        <span id={errorId} className="form-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
};

export default FormField;
