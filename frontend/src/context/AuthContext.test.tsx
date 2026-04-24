import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

// Helper component to expose context values
function TestConsumer({
  onAction,
}: {
  onAction?: (actions: { expire: () => void; clear: () => void }) => void;
}) {
  const { sessionState, intendedPath, setSessionExpired, clearSessionExpired } =
    useAuth();

  // Surface actions for the test to call imperatively
  if (onAction) {
    onAction({ expire: () => setSessionExpired("/portfolio"), clear: clearSessionExpired });
  }

  return (
    <div>
      <span data-testid="state">{sessionState}</span>
      <span data-testid="path">{intendedPath}</span>
    </div>
  );
}

describe("AuthContext", () => {
  it("starts with idle session state", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    expect(screen.getByTestId("state").textContent).toBe("idle");
  });

  it("transitions to expired and captures intended path", () => {
    let actions: { expire: () => void; clear: () => void } | undefined;

    render(
      <AuthProvider>
        <TestConsumer
          onAction={(a) => {
            actions = a;
          }}
        />
      </AuthProvider>,
    );

    act(() => {
      actions!.expire();
    });

    expect(screen.getByTestId("state").textContent).toBe("expired");
    expect(screen.getByTestId("path").textContent).toBe("/portfolio");
  });

  it("resets to idle after clearSessionExpired", () => {
    let actions: { expire: () => void; clear: () => void } | undefined;

    render(
      <AuthProvider>
        <TestConsumer
          onAction={(a) => {
            actions = a;
          }}
        />
      </AuthProvider>,
    );

    act(() => {
      actions!.expire();
    });
    expect(screen.getByTestId("state").textContent).toBe("expired");

    act(() => {
      actions!.clear();
    });
    expect(screen.getByTestId("state").textContent).toBe("idle");
  });

  it("does not flip to expired twice (idempotent)", () => {
    let actions: { expire: () => void; clear: () => void } | undefined;

    render(
      <AuthProvider>
        <TestConsumer
          onAction={(a) => {
            actions = a;
          }}
        />
      </AuthProvider>,
    );

    act(() => {
      actions!.expire();
      // second call should be a no-op
      actions!.expire();
    });

    expect(screen.getByTestId("state").textContent).toBe("expired");
    // Path captured on first call stays unchanged
    expect(screen.getByTestId("path").textContent).toBe("/portfolio");
  });

  it("throws when useAuth is used outside AuthProvider", () => {
    // Suppress expected React error boundary noise
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      "useAuth must be used within an AuthProvider",
    );
    spy.mockRestore();
  });
});
