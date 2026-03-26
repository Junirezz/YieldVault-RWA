import type React from "react";

export interface FormSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  error?: string;
}

const FormSelect: React.FC<FormSelectProps> = ({
  label,
  name,
  options,
  error,
  disabled,
  id,
  ...props
}) => {
  const selectId = id ?? name;
  const errorId = `${name}-error`;

  return (
    <div className="form-control">
      <label className="form-label" htmlFor={selectId}>{label}</label>
      <div className={`input-wrapper ${error ? "input-wrapper-error" : ""}`}>
        <select
          {...props}
          id={selectId}
          name={name}
          className={`portfolio-select ${props.className ?? ""}`.trim()}
          disabled={disabled}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : undefined}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <span id={errorId} className="form-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
};

export default FormSelect;
