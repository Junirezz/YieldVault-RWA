import React from "react";
import "./Input.css";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  leftIcon,
  rightIcon,
  fullWidth = true,
  className = "",
  id,
  disabled,
  ...props
}) => {
  const inputId = id || `input-${label?.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div className={`input-group ${fullWidth ? "full-width" : ""} ${className}`}>
      {label && (
        <label htmlFor={inputId} className="input-label">
          {label}
        </label>
      )}
      <div
        className={`input-wrapper ${error ? "is-error" : ""} ${disabled ? "is-disabled" : ""} ${
          leftIcon ? "has-left-icon" : ""
        } ${rightIcon ? "has-right-icon" : ""}`}
      >
        {leftIcon && <span className="input-icon-left">{leftIcon}</span>}
        <input
          id={inputId}
          className="input-field"
          disabled={disabled}
          {...props}
        />
        {rightIcon && <span className="input-icon-right">{rightIcon}</span>}
      </div>
      {(error || helperText) && (
        <span className={`input-message ${error ? "is-error" : ""}`}>
          {error || helperText}
        </span>
      )}
    </div>
  );
};
