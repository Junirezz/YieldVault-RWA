import React from "react";
import { Info } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { Popover } from "./Popover";
import type { Placement } from "../../hooks/useFloating";
import "./HelpIcon.css";

export interface HelpIconProps {
  content: string | React.ReactNode;
  variant?: "tooltip" | "popover";
  label?: string;
  size?: "sm" | "md";
  placement?: Placement;
  disabled?: boolean;
}

export const HelpIcon: React.FC<HelpIconProps> = ({
  content,
  variant = "tooltip",
  label = "More information",
  size = "sm",
  placement,
  disabled,
}) => {
  const iconSize = size === "md" ? 16 : 14;

  const button = (
    <button type="button" className="help-icon-btn" aria-label={label}>
      <Info size={iconSize} aria-hidden="true" />
    </button>
  );

  if (variant === "popover") {
    return (
      <Popover content={content} placement={placement} disabled={disabled}>
        {button}
      </Popover>
    );
  }

  return (
    <Tooltip content={content} placement={placement} disabled={disabled}>
      {button}
    </Tooltip>
  );
};

export default HelpIcon;
