import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFloating, type Placement } from "./useFloating";

// Helper to create a mock DOMRect
function mockRect(
  x: number,
  y: number,
  width: number,
  height: number
): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  } as DOMRect;
}

// Helper to set up trigger and floating refs with mock getBoundingClientRect
function setupRefs(
  result: { current: ReturnType<typeof useFloating> },
  triggerRect: DOMRect,
  panelWidth = 100,
  panelHeight = 40
) {
  const triggerEl = document.createElement("button");
  triggerEl.getBoundingClientRect = () => triggerRect;
  Object.defineProperty(result.current.triggerRef, "current", {
    value: triggerEl,
    writable: true,
    configurable: true,
  });

  const floatingEl = document.createElement("div");
  Object.defineProperty(floatingEl, "offsetWidth", { value: panelWidth, configurable: true });
  Object.defineProperty(floatingEl, "offsetHeight", { value: panelHeight, configurable: true });
  Object.defineProperty(result.current.floatingRef, "current", {
    value: floatingEl,
    writable: true,
    configurable: true,
  });
}

/**
 * Helper: create a hook starting with isOpen=false, set up refs, then rerender
 * with isOpen=true so calculatePosition runs with refs already in place.
 */
async function createHookWithRefs(
  placement: Placement,
  triggerRect: DOMRect,
  panelWidth = 100,
  panelHeight = 40,
  offset = 8
) {
  const { result, rerender } = renderHook(
    ({ isOpen }: { isOpen: boolean }) =>
      useFloating({ placement, offset, isOpen }),
    { initialProps: { isOpen: false } }
  );

  // Set refs while isOpen is false (no calculation runs yet)
  setupRefs(result, triggerRect, panelWidth, panelHeight);

  // Now open — calculatePosition runs with refs already set
  await act(async () => {
    rerender({ isOpen: true });
  });

  return { result, rerender };
}

describe("useFloating", () => {
  beforeEach(() => {
    // Set a standard viewport size
    Object.defineProperty(window, "innerWidth", { value: 1024, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 768, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("flip logic", () => {
    it("flips from top to bottom when trigger is near the top of the viewport", async () => {
      // Trigger near top — not enough room above for the panel
      // top=5, panel height=40, offset=8 → needs 48px above, only 5px available
      const triggerRect = mockRect(400, 5, 100, 30);

      const { result } = await createHookWithRefs("top", triggerRect, 100, 40);

      expect(result.current.actualPlacement).toBe("bottom");
    });

    it("flips from bottom to top when trigger is near the bottom of the viewport", async () => {
      // viewport height = 768, trigger bottom = 760, panel height = 40, offset = 8 → needs 808 > 768
      const triggerRect = mockRect(400, 720, 100, 40); // bottom = 760

      const { result } = await createHookWithRefs("bottom", triggerRect, 100, 40);

      expect(result.current.actualPlacement).toBe("top");
    });

    it("flips from left to right when trigger is near the left edge", async () => {
      // left=5, panel width=100, offset=8 → needs 113px to the left, only 5px available
      const triggerRect = mockRect(5, 300, 100, 40);

      const { result } = await createHookWithRefs("left", triggerRect, 100, 40);

      expect(result.current.actualPlacement).toBe("right");
    });

    it("flips from right to left when trigger is near the right edge", async () => {
      // viewport width = 1024, trigger right = 1020, panel width = 100, offset = 8 → needs 1128 > 1024
      const triggerRect = mockRect(920, 300, 100, 40); // right = 1020

      const { result } = await createHookWithRefs("right", triggerRect, 100, 40);

      expect(result.current.actualPlacement).toBe("left");
    });

    it("does not flip when preferred placement fits within the viewport", async () => {
      // Trigger in the center — plenty of room above (400 - 40 - 8 = 352px)
      const triggerRect = mockRect(400, 400, 100, 40);

      const { result } = await createHookWithRefs("top", triggerRect, 100, 40);

      expect(result.current.actualPlacement).toBe("top");
    });

    it("preserves alignment suffix when flipping (top-start → bottom-start)", async () => {
      const triggerRect = mockRect(400, 5, 100, 30);

      const { result } = await createHookWithRefs("top-start", triggerRect, 100, 40);

      expect(result.current.actualPlacement).toBe("bottom-start");
    });

    it("preserves alignment suffix when flipping (top-end → bottom-end)", async () => {
      const triggerRect = mockRect(400, 5, 100, 30);

      const { result } = await createHookWithRefs("top-end", triggerRect, 100, 40);

      expect(result.current.actualPlacement).toBe("bottom-end");
    });
  });

  describe("offset application", () => {
    it("applies the default 8px offset for placement=bottom", async () => {
      const triggerRect = mockRect(400, 300, 100, 40); // bottom = 340

      const { result } = await createHookWithRefs("bottom", triggerRect, 100, 40, 8);

      // top should be triggerRect.bottom + offset = 340 + 8 = 348
      expect(result.current.floatingStyle.top).toBe(348);
    });

    it("applies the default 8px offset for placement=top", async () => {
      const triggerRect = mockRect(400, 300, 100, 40); // top = 300

      const { result } = await createHookWithRefs("top", triggerRect, 100, 40, 8);

      // top should be triggerRect.top - panelHeight - offset = 300 - 40 - 8 = 252
      expect(result.current.floatingStyle.top).toBe(252);
    });

    it("applies the default 8px offset for placement=right", async () => {
      const triggerRect = mockRect(400, 300, 100, 40); // right = 500

      const { result } = await createHookWithRefs("right", triggerRect, 100, 40, 8);

      // left should be triggerRect.right + offset = 500 + 8 = 508
      expect(result.current.floatingStyle.left).toBe(508);
    });

    it("applies the default 8px offset for placement=left", async () => {
      const triggerRect = mockRect(400, 300, 100, 40); // left = 400

      const { result } = await createHookWithRefs("left", triggerRect, 100, 40, 8);

      // left should be triggerRect.left - panelWidth - offset = 400 - 100 - 8 = 292
      expect(result.current.floatingStyle.left).toBe(292);
    });

    it("applies a custom offset value", async () => {
      const triggerRect = mockRect(400, 300, 100, 40); // bottom = 340

      const { result } = await createHookWithRefs("bottom", triggerRect, 100, 40, 16);

      // top should be triggerRect.bottom + offset = 340 + 16 = 356
      expect(result.current.floatingStyle.top).toBe(356);
    });

    it("applies offset for all 8 placement values without error", async () => {
      const placements: Placement[] = [
        "top", "bottom", "left", "right",
        "top-start", "top-end", "bottom-start", "bottom-end",
      ];

      for (const p of placements) {
        const triggerRect = mockRect(400, 300, 100, 40);

        const { result } = await createHookWithRefs(p, triggerRect, 100, 40, 8);

        // Just verify it returns a valid numeric position
        expect(typeof result.current.floatingStyle.top).toBe("number");
        expect(typeof result.current.floatingStyle.left).toBe("number");
      }
    });
  });

  describe("isHidden flag", () => {
    it("sets isHidden=true when trigger is above the viewport", async () => {
      const triggerRect = mockRect(400, -100, 100, 40); // bottom = -60 < 0

      const { result } = await createHookWithRefs("bottom", triggerRect, 100, 40);

      expect(result.current.isHidden).toBe(true);
    });

    it("sets isHidden=true when trigger is below the viewport", async () => {
      const triggerRect = mockRect(400, 800, 100, 40); // top = 800 > 768

      const { result } = await createHookWithRefs("top", triggerRect, 100, 40);

      expect(result.current.isHidden).toBe(true);
    });

    it("sets isHidden=true when trigger is to the left of the viewport", async () => {
      const triggerRect = mockRect(-200, 300, 100, 40); // right = -100 < 0

      const { result } = await createHookWithRefs("right", triggerRect, 100, 40);

      expect(result.current.isHidden).toBe(true);
    });

    it("sets isHidden=true when trigger is to the right of the viewport", async () => {
      const triggerRect = mockRect(1100, 300, 100, 40); // left = 1100 > 1024

      const { result } = await createHookWithRefs("left", triggerRect, 100, 40);

      expect(result.current.isHidden).toBe(true);
    });

    it("sets isHidden=false when trigger is visible in the viewport", async () => {
      const triggerRect = mockRect(400, 300, 100, 40);

      const { result } = await createHookWithRefs("bottom", triggerRect, 100, 40);

      expect(result.current.isHidden).toBe(false);
    });
  });

  describe("scroll and resize event listeners", () => {
    it("attaches scroll and resize listeners when isOpen is true", async () => {
      const addEventListenerSpy = vi.spyOn(window, "addEventListener");

      const triggerRect = mockRect(400, 300, 100, 40);
      const { result } = await createHookWithRefs("bottom", triggerRect, 100, 40);

      // Verify refs are set (to confirm the hook is in a valid state)
      expect(result.current.triggerRef.current).not.toBeNull();

      const scrollCalls = addEventListenerSpy.mock.calls.filter(([event]) => event === "scroll");
      const resizeCalls = addEventListenerSpy.mock.calls.filter(([event]) => event === "resize");

      expect(scrollCalls.length).toBeGreaterThan(0);
      expect(resizeCalls.length).toBeGreaterThan(0);
    });

    it("removes scroll and resize listeners when isOpen becomes false", async () => {
      const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

      const { rerender } = renderHook(
        ({ isOpen }: { isOpen: boolean }) =>
          useFloating({ placement: "bottom", isOpen }),
        { initialProps: { isOpen: true } }
      );

      await act(async () => {});

      rerender({ isOpen: false });

      await act(async () => {});

      const scrollCalls = removeEventListenerSpy.mock.calls.filter(([event]) => event === "scroll");
      const resizeCalls = removeEventListenerSpy.mock.calls.filter(([event]) => event === "resize");

      expect(scrollCalls.length).toBeGreaterThan(0);
      expect(resizeCalls.length).toBeGreaterThan(0);
    });

    it("recalculates position on scroll event (debounced)", async () => {
      vi.useFakeTimers();

      const triggerRect = mockRect(400, 300, 100, 40);

      const { result, rerender } = renderHook(
        ({ isOpen }: { isOpen: boolean }) =>
          useFloating({ placement: "bottom", offset: 8, isOpen }),
        { initialProps: { isOpen: false } }
      );

      setupRefs(result, triggerRect, 100, 40);

      await act(async () => {
        rerender({ isOpen: true });
        vi.runAllTimers();
      });

      const initialTop = result.current.floatingStyle.top;
      expect(initialTop).toBe(348); // 300 + 40 + 8

      // Simulate trigger moving (e.g., after scroll)
      const newTriggerRect = mockRect(400, 200, 100, 40); // bottom = 240
      const triggerEl = result.current.triggerRef.current!;
      triggerEl.getBoundingClientRect = () => newTriggerRect;

      await act(async () => {
        window.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(100);
      });

      // Position should have been recalculated: new top = 240 + 8 = 248
      expect(result.current.floatingStyle.top).not.toBe(initialTop);
      expect(result.current.floatingStyle.top).toBe(248);

      vi.useRealTimers();
    });

    it("recalculates position on resize event (debounced)", async () => {
      vi.useFakeTimers();

      const triggerRect = mockRect(400, 300, 100, 40);

      const { result, rerender } = renderHook(
        ({ isOpen }: { isOpen: boolean }) =>
          useFloating({ placement: "bottom", offset: 8, isOpen }),
        { initialProps: { isOpen: false } }
      );

      setupRefs(result, triggerRect, 100, 40);

      await act(async () => {
        rerender({ isOpen: true });
        vi.runAllTimers();
      });

      const initialTop = result.current.floatingStyle.top;
      expect(initialTop).toBe(348); // 300 + 40 + 8

      // Simulate trigger moving after resize
      const newTriggerRect = mockRect(400, 150, 100, 40); // bottom = 190
      const triggerEl = result.current.triggerRef.current!;
      triggerEl.getBoundingClientRect = () => newTriggerRect;

      await act(async () => {
        window.dispatchEvent(new Event("resize"));
        vi.advanceTimersByTime(100);
      });

      expect(result.current.floatingStyle.top).not.toBe(initialTop);
      expect(result.current.floatingStyle.top).toBe(198); // 190 + 8

      vi.useRealTimers();
    });
  });

  describe("position: fixed", () => {
    it("always returns position: fixed in floatingStyle", async () => {
      const triggerRect = mockRect(400, 300, 100, 40);

      const { result } = await createHookWithRefs("bottom", triggerRect, 100, 40);

      expect(result.current.floatingStyle.position).toBe("fixed");
    });
  });
});
