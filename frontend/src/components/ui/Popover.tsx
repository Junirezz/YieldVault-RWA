import React, {
  useId,
  useRef,
  useState,
  useEffect,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useFloating } from "../../hooks/useFloating";
import type { Placement } from "../../hooks/useFloating";
import "./Popover.css";

export interface PopoverProps {
  content: React.ReactNode;
  children: React.ReactElement;
  title?: string;
  placement?: Placement;
  disabled?: boolean;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export const Popover: React.FC<PopoverProps> = ({
  content,
  children,
  title,
  placement = "bottom",
  disabled = false,
}) => {
  const titleId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const { triggerRef, floatingRef, floatingStyle } = useFloating({
    placement,
    isOpen,
  });

  // Warn in development if children is not a valid React element
  if (import.meta.env.DEV && !React.isValidElement(children)) {
    console.warn(
      "[Popover] `children` must be a valid React element. Received:",
      children
    );
  }

  const closePanel = useCallback(() => {
    setIsOpen(false);
    if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, []);

  const openPanel = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    setIsOpen(true);
  }, []);

  // Move focus into panel after it opens
  useEffect(() => {
    if (!isOpen) return;

    const frame = requestAnimationFrame(() => {
      const panel = floatingRef.current;
      if (!panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        (panel as HTMLElement).focus();
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [isOpen, floatingRef]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closePanel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closePanel]);

  // Outside click handler
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const panel = floatingRef.current;
      const trigger = triggerRef.current;

      if (
        panel &&
        !panel.contains(target) &&
        trigger &&
        !trigger.contains(target)
      ) {
        closePanel();
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen, closePanel, triggerRef, floatingRef]);

  // Focus trap
  const handlePanelKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Tab") return;

      const panel = floatingRef.current;
      if (!panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (
          document.activeElement === first ||
          document.activeElement === panel
        ) {
          last.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    },
    [floatingRef]
  );

  const handleTriggerClick = useCallback(() => {
    if (isOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }, [isOpen, openPanel, closePanel]);

  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (isOpen) {
          closePanel();
        } else {
          openPanel();
        }
      }
    },
    [isOpen, openPanel, closePanel]
  );

  if (disabled || !React.isValidElement(children)) {
    return <>{children}</>;
  }

  return (
    <>
      <span
        ref={triggerRef as React.RefObject<HTMLSpanElement>}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        style={{ display: "inline-flex", alignItems: "center" }}
      >
        {children}
      </span>

      {isOpen &&
        createPortal(
          <div
            ref={floatingRef as React.RefObject<HTMLDivElement>}
            role="dialog"
            aria-modal="false"
            aria-labelledby={title ? titleId : undefined}
            className="popover-panel"
            tabIndex={-1}
            style={floatingStyle}
            onKeyDown={handlePanelKeyDown}
          >
            {title && (
              <div className="popover-header">
                <h3 id={titleId} className="popover-title">
                  {title}
                </h3>
                <button
                  type="button"
                  className="popover-close"
                  aria-label="Close"
                  onClick={closePanel}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            )}

            {!title && (
              <button
                type="button"
                className="popover-close popover-close-standalone"
                aria-label="Close"
                onClick={closePanel}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}

            <div className="popover-content">{content}</div>
          </div>,
          document.body
        )}
    </>
  );
};

export default Popover;
