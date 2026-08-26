import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useFocusTrap } from "./useFocusTrap";

function TrapHarness({ onEscape }: { onEscape: () => void }) {
  const ref = useFocusTrap<HTMLDivElement>({ active: true, onEscape });
  return (
    <div ref={ref} tabIndex={-1} data-testid="trap">
      <button>First</button>
      <button>Last</button>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("moves initial focus to the first focusable element", async () => {
    render(<TrapHarness onEscape={() => undefined} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    });
  });

  it("cycles Tab from the last element back to the first", async () => {
    const user = userEvent.setup();
    render(<TrapHarness onEscape={() => undefined} />);

    screen.getByRole("button", { name: "Last" }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("calls onEscape when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    render(<TrapHarness onEscape={onEscape} />);

    await user.keyboard("{Escape}");
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
