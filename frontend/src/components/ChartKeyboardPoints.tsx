/**
 * ChartKeyboardPoints
 *
 * An absolutely-positioned SVG overlay that renders one focusable <circle>
 * per data point.  Keyboard users (and screen readers navigating focusable
 * elements) can Tab to the first point and then use ← / → arrow keys to step
 * through every point.  Each point announces its value via `aria-label`.
 *
 * The overlay is transparent to pointer events so the Recharts tooltip still
 * works on hover.  It is sized to match the chart's data area via the
 * `chartArea` prop (left/top offsets and width/height, as reported by
 * Recharts internals or estimated by the consumer).
 *
 * Usage:
 *   // Inside a `position: relative` chart wrapper:
 *   <ChartKeyboardPoints
 *     points={data.map((d, i) => ({
 *       index: i,
 *       x: scaleX(d.date),    // pixel x within the chart area
 *       y: scaleY(d.value),   // pixel y within the chart area
 *       label: `${d.date}: ${d.value}`,
 *     }))}
 *     chartArea={{ left: 40, top: 8, width: 560, height: 204 }}
 *     aria-label="Daily yield data points — use arrow keys to navigate"
 *   />
 *
 * When pixel coordinates are not available (e.g. on first render or when
 * Recharts has not yet measured its layout) an empty list can be passed
 * safely — the overlay renders nothing interactive.
 */
import React, { useRef, useCallback } from "react";

export interface ChartPoint {
  /** Stable index / unique key within the current dataset. */
  index: number;
  /** Pixel x coordinate relative to the chart's content area origin. */
  x: number;
  /** Pixel y coordinate relative to the chart's content area origin. */
  y: number;
  /** Full accessible description announced by the screen reader. */
  label: string;
}

export interface ChartArea {
  /** Left offset of the chart's data area in pixels (e.g. YAxis width). */
  left: number;
  /** Top offset of the chart's data area in pixels (e.g. top margin). */
  top: number;
  /** Width of the chart's data area in pixels. */
  width: number;
  /** Height of the chart's data area in pixels. */
  height: number;
}

export interface ChartKeyboardPointsProps {
  points: readonly ChartPoint[];
  chartArea: ChartArea;
  /** Accessible label for the entire focusable region. */
  "aria-label"?: string;
  /** Called when the focused point index changes. */
  onFocusPoint?: (index: number) => void;
  /** Optional test id. */
  "data-testid"?: string;
}

/**
 * Clamps `value` to `[min, max]`.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const ChartKeyboardPoints: React.FC<ChartKeyboardPointsProps> = ({
  points,
  chartArea,
  "aria-label": ariaLabel = "Chart data points — use arrow keys to navigate",
  onFocusPoint,
  "data-testid": testId = "chart-keyboard-points",
}) => {
  const circleRefs = useRef<(SVGCircleElement | null)[]>([]);

  const focusPoint = useCallback(
    (index: number) => {
      const clamped = clamp(index, 0, points.length - 1);
      circleRefs.current[clamped]?.focus();
      onFocusPoint?.(clamped);
    },
    [points.length, onFocusPoint],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<SVGCircleElement>, currentIndex: number) => {
      switch (event.key) {
        case "ArrowRight":
        case "ArrowUp":
          event.preventDefault();
          focusPoint(currentIndex + 1);
          break;
        case "ArrowLeft":
        case "ArrowDown":
          event.preventDefault();
          focusPoint(currentIndex - 1);
          break;
        case "Home":
          event.preventDefault();
          focusPoint(0);
          break;
        case "End":
          event.preventDefault();
          focusPoint(points.length - 1);
          break;
        default:
          break;
      }
    },
    [focusPoint, points.length],
  );

  if (points.length === 0) return null;

  const { left, top, width, height } = chartArea;
  const svgWidth = left + width;
  const svgHeight = top + height;

  return (
    /*
     * The SVG sits on top of the Recharts SVG via absolute positioning.
     * pointer-events:none lets mouse events pass through to Recharts.
     * The focusable circles themselves override pointer-events so mouse
     * clicks still reach them (not needed for a11y but harmless).
     */
    <svg
      data-testid={testId}
      aria-label={ariaLabel}
      role="img"
      width={svgWidth}
      height={svgHeight}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      <g transform={`translate(${left}, ${top})`}>
        {points.map((point, i) => (
          <circle
            key={point.index}
            ref={(el) => {
              circleRefs.current[i] = el;
            }}
            cx={point.x}
            cy={point.y}
            r={6}
            fill="transparent"
            stroke="transparent"
            strokeWidth={0}
            tabIndex={i === 0 ? 0 : -1}
            role="img"
            aria-label={point.label}
            style={{ pointerEvents: "auto", outline: "none", cursor: "default" }}
            onKeyDown={(e) => handleKeyDown(e, i)}
            onFocus={() => onFocusPoint?.(i)}
            /* Visible focus ring drawn via CSS :focus-visible */
            className="chart-keyboard-point"
          />
        ))}
      </g>
    </svg>
  );
};

export default ChartKeyboardPoints;
