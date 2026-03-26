import type React from "react";

export interface SubmitButtonProps {
  loading: boolean;
  disabled: boolean;
  label: string;
  loadingLabel?: string;
}

const SubmitButton: React.FC<SubmitButtonProps> = ({
  loading,
  disabled,
  label,
  loadingLabel = "Loading...",
}) => {
  const isDisabled = disabled || loading;

  return (
    <button className="btn btn-primary" type="submit" disabled={isDisabled}>
      {loading ? loadingLabel : label}
    </button>
  );
};

export default SubmitButton;
