import React from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { formFieldFocus } from "../../motion/variants";
import "./Input.css";

interface InputProps extends Omit<HTMLMotionProps<"input">, "children"> {
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
  const prefersReducedMotion = useReducedMotion();
  const inputId = id || `input-${label?.toLowerCase().replace(/\s+/g, "-")}`;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;
  const describedBy = [error ? errorId : undefined, helperText ? helperId : undefined]
    .filter(Boolean)
    .join(" ") || undefined;

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
        {leftIcon && <span className="input-icon-left" aria-hidden="true">{leftIcon}</span>}
        <motion.input
          id={inputId}
          className="input-field"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          whileFocus={prefersReducedMotion || disabled ? undefined : formFieldFocus}
          {...props}
        />
        {rightIcon && <span className="input-icon-right" aria-hidden="true">{rightIcon}</span>}
      </div>
      {(error || helperText) && (
        <span
          id={error ? errorId : helperId}
          className={`input-message ${error ? "is-error" : ""}`}
          role={error ? "alert" : undefined}
        >
          {error || helperText}
        </span>
      )}
    </div>
  );
};
