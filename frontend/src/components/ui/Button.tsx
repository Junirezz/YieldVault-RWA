import React from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { AlertCircle, Check, Loader2 } from "../icons";
import { buttonHover, buttonTap } from "../../motion/variants";
import "./Button.css";

export type ButtonStatus = "idle" | "pending" | "success" | "error";

interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: "primary" | "secondary" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  status?: ButtonStatus;
  loadingLabel?: React.ReactNode;
  successLabel?: React.ReactNode;
  errorLabel?: React.ReactNode;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  children?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = "primary",
  size = "md",
  isLoading = false,
  status = "idle",
  loadingLabel,
  successLabel,
  errorLabel,
  leftIcon,
  rightIcon,
  className = "",
  disabled,
  "aria-busy": ariaBusy,
  ...props
}) => {
  const prefersReducedMotion = useReducedMotion();
  const resolvedStatus: ButtonStatus = isLoading ? "pending" : status;
  const isPending = resolvedStatus === "pending";
  const isSuccess = resolvedStatus === "success";
  const isError = resolvedStatus === "error";
  const isDisabled = disabled || isPending;
  const allowMotion = !prefersReducedMotion && !isDisabled;

  const content =
    isPending && loadingLabel !== undefined
      ? loadingLabel
      : isSuccess && successLabel !== undefined
        ? successLabel
        : isError && errorLabel !== undefined
          ? errorLabel
          : children;

  const showSpinner = isPending && loadingLabel === undefined;
  const showSuccessIcon = isSuccess && successLabel === undefined;
  const showErrorIcon = isError && errorLabel === undefined;

  return (
    <motion.button
      className={`btn btn-${variant} btn-${size} ${isPending ? "is-loading" : ""} ${isSuccess ? "is-success" : ""} ${isError ? "is-error" : ""} ${className}`}
      disabled={isDisabled}
      aria-busy={ariaBusy ?? isPending}
      whileHover={allowMotion ? buttonHover : undefined}
      whileTap={allowMotion ? buttonTap : undefined}
      {...props}
    >
      {showSpinner && <span className="btn-spinner" />}
      {isPending && loadingLabel !== undefined && (
        <span className="btn-icon-left" aria-hidden="true">
          <Loader2 size={16} className="btn-inline-spin" />
        </span>
      )}
      {showSuccessIcon && (
        <span className="btn-icon-left" aria-hidden="true">
          <Check size={16} />
        </span>
      )}
      {showErrorIcon && (
        <span className="btn-icon-left" aria-hidden="true">
          <AlertCircle size={16} />
        </span>
      )}
      {!isPending && !isSuccess && !isError && leftIcon && (
        <span className="btn-icon-left">{leftIcon}</span>
      )}
      <span className={`btn-content ${showSpinner ? "btn-content-hidden" : ""}`}>{content}</span>
      {!isPending && !isSuccess && !isError && rightIcon && (
        <span className="btn-icon-right">{rightIcon}</span>
      )}
    </motion.button>
  );
};
