import React, { useId, useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useFloating } from "../../hooks/useFloating";
import type { Placement } from "../../hooks/useFloating";
import "./Tooltip.css";

export interface TooltipProps {
  content: string | React.ReactNode;
  children: React.ReactElement;
  placement?: Placement;
  disabled?: boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  placement = "top",
  disabled = false,
}) => {
  const id = useId();
  const [isVisible, setIsVisible] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { triggerRef, floatingRef, floatingStyle, isHidden } = useFloating({
    placement,
    isOpen: isVisible,
  });

  // Warn in development if children is not a valid React element
  if (import.meta.env.DEV && !React.isValidElement(children)) {
    console.warn(
      "[Tooltip] `children` must be a valid React element. Received:",
      children
    );
  }

  const clearTimers = useCallback(() => {
    if (showTimerRef.current !== null) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const show = useCallback((delay: number) => {
    clearTimers();
    showTimerRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  }, [clearTimers]);

  const hide = useCallback(() => {
    clearTimers();
    hideTimerRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 150);
  }, [clearTimers]);

  // Escape key handler — active only when panel is visible
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearTimers();
        setIsVisible(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isVisible, clearTimers, triggerRef]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  // If disabled, render children as-is with no handlers
  if (disabled || !React.isValidElement(children)) {
    return <>{children}</>;
  }

  const panelVisible = isVisible && !isHidden;

  return (
    <>
      <span
        ref={triggerRef as React.RefObject<HTMLSpanElement>}
        onMouseEnter={() => show(300)}
        onMouseLeave={hide}
        onFocus={() => show(0)}
        onBlur={hide}
        aria-describedby={panelVisible ? id : undefined}
        style={{ display: "inline-flex", alignItems: "center" }}
      >
        {children}
      </span>

      {isVisible &&
        createPortal(
          <div
            ref={floatingRef as React.RefObject<HTMLDivElement>}
            id={id}
            role="tooltip"
            className="tooltip-panel"
            style={{
              ...floatingStyle,
              visibility: panelVisible ? "visible" : "hidden",
              pointerEvents: "none",
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
};

export default Tooltip;
