import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useTranslation } from "../i18n";

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  showCloseButton?: boolean;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  footer?: React.ReactNode;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  showCloseButton = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  footer,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}) => {
  const { t } = useTranslation();
  const panelRef = useFocusTrap<HTMLDivElement>({
    active: isOpen,
    onEscape: onClose,
    closeOnEscape,
  });

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && closeOnBackdropClick) {
      onClose();
    }
  };

  const drawerId = ariaLabelledBy || (title ? "drawer-title" : undefined);
  const descId = ariaDescribedBy || (description ? "drawer-desc" : undefined);

  return createPortal(
    <div
      className="drawer-backdrop"
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={drawerId}
        aria-describedby={descId}
        className="drawer-panel glass-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {(title || showCloseButton) && (
          <div className="drawer-header">
            <div>
              {title && (
                <h2 id={drawerId} className="drawer-title">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="drawer-description">
                  {description}
                </p>
              )}
            </div>
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label={t("drawer.closeLabel")}
                className="drawer-close-btn"
              >
                <X size={20} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        <div className="drawer-body">{children}</div>

        {footer && <div className="drawer-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

export default Drawer;
