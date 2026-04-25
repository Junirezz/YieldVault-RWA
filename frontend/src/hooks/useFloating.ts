import { useRef, useState, useEffect, useCallback } from "react";

export type Placement =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-start"
  | "top-end"
  | "bottom-start"
  | "bottom-end";

export interface UseFloatingOptions {
  placement?: Placement;
  offset?: number;
  isOpen: boolean;
}

export interface UseFloatingReturn {
  triggerRef: React.RefObject<HTMLElement>;
  floatingRef: React.RefObject<HTMLElement>;
  floatingStyle: React.CSSProperties;
  actualPlacement: Placement;
  isHidden: boolean;
}

/**
 * Returns the primary axis of a placement (the side the panel appears on).
 */
function getPrimaryAxis(placement: Placement): "top" | "bottom" | "left" | "right" {
  if (placement.startsWith("top")) return "top";
  if (placement.startsWith("bottom")) return "bottom";
  if (placement.startsWith("left")) return "left";
  return "right";
}

/**
 * Returns the opposite placement on the primary axis.
 */
function getOppositePlacement(placement: Placement): Placement {
  const axis = getPrimaryAxis(placement);
  const suffix = placement.includes("-") ? placement.slice(placement.indexOf("-")) : "";
  const oppositeAxis: Record<string, string> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
  };
  return (oppositeAxis[axis] + suffix) as Placement;
}

/**
 * Computes the top/left coordinates (viewport-relative, for position:fixed) for the
 * floating panel given the trigger rect, panel dimensions, placement, and offset.
 * Also clamps to viewport edges.
 */
function computePosition(
  triggerRect: DOMRect,
  panelWidth: number,
  panelHeight: number,
  placement: Placement,
  offset: number
): { top: number; left: number } {
  const axis = getPrimaryAxis(placement);
  let top = 0;
  let left = 0;

  // Position on the primary axis
  switch (axis) {
    case "top":
      top = triggerRect.top - panelHeight - offset;
      break;
    case "bottom":
      top = triggerRect.bottom + offset;
      break;
    case "left":
      left = triggerRect.left - panelWidth - offset;
      break;
    case "right":
      left = triggerRect.right + offset;
      break;
  }

  // Alignment on the cross axis
  if (axis === "top" || axis === "bottom") {
    if (placement.endsWith("-start")) {
      left = triggerRect.left;
    } else if (placement.endsWith("-end")) {
      left = triggerRect.right - panelWidth;
    } else {
      // center
      left = triggerRect.left + triggerRect.width / 2 - panelWidth / 2;
    }
  } else {
    // left or right axis — align vertically
    if (placement.endsWith("-start")) {
      top = triggerRect.top;
    } else if (placement.endsWith("-end")) {
      top = triggerRect.bottom - panelHeight;
    } else {
      // center
      top = triggerRect.top + triggerRect.height / 2 - panelHeight / 2;
    }
  }

  // Clamp to viewport edges
  left = Math.max(0, Math.min(window.innerWidth - panelWidth, left));
  top = Math.max(0, Math.min(window.innerHeight - panelHeight, top));

  return { top, left };
}

/**
 * Determines whether the floating panel would overflow the viewport on the primary axis
 * for the given placement, before clamping.
 */
function wouldOverflow(
  triggerRect: DOMRect,
  panelWidth: number,
  panelHeight: number,
  placement: Placement,
  offset: number
): boolean {
  const axis = getPrimaryAxis(placement);

  switch (axis) {
    case "top":
      return triggerRect.top - panelHeight - offset < 0;
    case "bottom":
      return triggerRect.bottom + panelHeight + offset > window.innerHeight;
    case "left":
      return triggerRect.left - panelWidth - offset < 0;
    case "right":
      return triggerRect.right + panelWidth + offset > window.innerWidth;
  }
}

/**
 * Returns true when the trigger element is entirely outside the visible viewport.
 */
function isTriggerOutOfViewport(rect: DOMRect): boolean {
  return (
    rect.bottom < 0 ||
    rect.top > window.innerHeight ||
    rect.right < 0 ||
    rect.left > window.innerWidth
  );
}

export function useFloating({
  placement = "top",
  offset = 8,
  isOpen,
}: UseFloatingOptions): UseFloatingReturn {
  const triggerRef = useRef<HTMLElement>(null);
  const floatingRef = useRef<HTMLElement>(null);

  const [floatingStyle, setFloatingStyle] = useState<React.CSSProperties>({
    position: "fixed",
    top: 0,
    left: 0,
  });
  const [actualPlacement, setActualPlacement] = useState<Placement>(placement);
  const [isHidden, setIsHidden] = useState(false);

  const calculatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const floating = floatingRef.current;

    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();

    // Hide when trigger is entirely outside the viewport
    if (isTriggerOutOfViewport(triggerRect)) {
      setIsHidden(true);
      return;
    }
    setIsHidden(false);

    // Use panel dimensions if available, otherwise fall back to 0 (will be recalculated)
    const panelWidth = floating ? floating.offsetWidth : 0;
    const panelHeight = floating ? floating.offsetHeight : 0;

    // Determine effective placement (flip if needed)
    let effectivePlacement = placement;
    if (wouldOverflow(triggerRect, panelWidth, panelHeight, placement, offset)) {
      const flipped = getOppositePlacement(placement);
      // Only flip if the opposite side actually fits (or fits better)
      if (!wouldOverflow(triggerRect, panelWidth, panelHeight, flipped, offset)) {
        effectivePlacement = flipped;
      }
      // If neither side fits, keep the preferred placement and let clamping handle it
    }

    const { top, left } = computePosition(
      triggerRect,
      panelWidth,
      panelHeight,
      effectivePlacement,
      offset
    );

    setActualPlacement(effectivePlacement);
    setFloatingStyle({
      position: "fixed",
      top,
      left,
    });
  }, [placement, offset]);

  // Recalculate when isOpen becomes true
  useEffect(() => {
    if (isOpen) {
      calculatePosition();
    }
  }, [isOpen, calculatePosition]);

  // Attach debounced scroll/resize listeners when open
  useEffect(() => {
    if (!isOpen) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const handleEvent = () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        calculatePosition();
      }, 100);
    };

    window.addEventListener("scroll", handleEvent, { passive: true });
    window.addEventListener("resize", handleEvent, { passive: true });

    return () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      window.removeEventListener("scroll", handleEvent);
      window.removeEventListener("resize", handleEvent);
    };
  }, [isOpen, calculatePosition]);

  return {
    triggerRef,
    floatingRef,
    floatingStyle,
    actualPlacement,
    isHidden,
  };
}
