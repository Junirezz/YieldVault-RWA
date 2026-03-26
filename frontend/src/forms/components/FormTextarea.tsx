import type React from "react";

export interface FormTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  name: string;
  error?: string;
}

const FormTextarea: React.FC<FormTextareaProps> = ({
  label,
  name,
  error,
  disabled,
  id,
  ...props
}) => {
  const textareaId = id ?? name;
  const errorId = `${name}-error`;

  return (
    <div className="form-control">
      <label className="form-label" htmlFor={textareaId}>{label}</label>
      <div className={`input-wrapper ${error ? "input-wrapper-error" : ""}`}>
        <textarea
          {...props}
          id={textareaId}
          name={name}
          className={`form-textarea ${props.className ?? ""}`.trim()}
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

export default FormTextarea;
