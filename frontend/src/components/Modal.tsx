import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showCloseButton?: boolean;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  footer?: React.ReactNode;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = 'md',
  showCloseButton = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  footer,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}) => {
  const modalRef = useFocusTrap<HTMLDivElement>({
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

  const maxWidthMap = {
    sm: '320px',
    md: '480px',
    lg: '600px',
    xl: '800px',
  };

  const modalId = ariaLabelledBy || (title ? 'modal-title' : undefined);
  const descId = ariaDescribedBy || (description ? 'modal-desc' : undefined);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={modalId}
        aria-describedby={descId}
        className="glass-panel"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-glass)',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          maxWidth: maxWidthMap[size],
          width: '100%',
          maxHeight: '90vh',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          position: 'relative',
          outline: 'none',
        }}
      >
        {(title || showCloseButton) && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '20px 24px',
              borderBottom: title ? '1px solid var(--border-glass)' : 'none',
            }}
          >
            <div>
              {title && (
                <h2
                  id={modalId}
                  style={{
                    margin: 0,
                    fontSize: 'var(--text-xl)',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                  }}
                >
                  {title}
                </h2>
              )}
              {description && (
                <p
                  id={descId}
                  style={{
                    margin: '8px 0 0 0',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {description}
                </p>
              )}
            </div>
            {showCloseButton && (
              <button
                onClick={onClose}
                aria-label="Close dialog"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px',
                }}
              >
                <X size={20} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        <div
          style={{
            padding: '24px',
            overflowY: 'auto',
            flex: '1 1 auto',
          }}
        >
          {children}
        </div>

        {footer && (
          <div
            style={{
              padding: '16px 24px',
              borderTop: '1px solid var(--border-glass)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '12px',
              background: 'var(--bg-card)',
              borderBottomLeftRadius: '16px',
              borderBottomRightRadius: '16px',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default Modal;
