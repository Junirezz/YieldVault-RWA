import { useCallback, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  );
}

export interface UseFocusTrapOptions {
  active: boolean;
  onEscape?: () => void;
  closeOnEscape?: boolean;
  /**
   * Trap Tab focus inside the container. Non-modal surfaces (for example a
   * notification popover) set this to `false` so keyboard users can still Tab
   * back out to the page behind.
   */
  trapTab?: boolean;
  /** Lock page scroll behind the surface while active. */
  lockScroll?: boolean;
}

/**
 * Traps Tab focus inside a container while `active` is true, restores the
 * previously focused element on deactivate, and optionally handles Escape.
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>({
  active,
  onEscape,
  closeOnEscape = true,
  trapTab = true,
  lockScroll = true,
}: UseFocusTrapOptions) {
  const containerRef = useRef<T>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!active) return;

      if (event.key === "Escape" && closeOnEscape) {
        onEscape?.();
        return;
      }

      if (event.key !== "Tab" || !containerRef.current || !trapTab) return;

      const focusable = getFocusable(containerRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        containerRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first || document.activeElement === containerRef.current) {
          last.focus();
          event.preventDefault();
        }
      } else if (document.activeElement === last) {
        first.focus();
        event.preventDefault();
      }
    },
    [active, closeOnEscape, onEscape, trapTab],
  );

  useEffect(() => {
    if (!active) return;

    previousFocusRef.current = document.activeElement as HTMLElement;
    document.addEventListener("keydown", handleKeyDown);
    if (lockScroll) document.body.style.overflow = "hidden";

    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const focusable = getFocusable(container);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        container.focus();
      }
    });

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      if (lockScroll) document.body.style.overflow = "";
      previousFocusRef.current?.focus();
    };
  }, [active, handleKeyDown, lockScroll]);

  return containerRef;
}

export { FOCUSABLE_SELECTOR, getFocusable };
