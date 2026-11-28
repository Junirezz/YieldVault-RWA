import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import NetworkSelector from "./NetworkSelector";
import { readSelectedNetwork } from "../config/selectedNetwork";

describe("NetworkSelector", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the persisted selection", () => {
    localStorage.setItem("yieldvault.selected_network", "mainnet");
    render(<NetworkSelector />);

    expect(screen.getByTestId("network-selector")).toHaveValue("mainnet");
  });

  it("persists changes so the next mount restores them", () => {
    const { unmount } = render(<NetworkSelector />);
    const select = screen.getByTestId("network-selector");

    fireEvent.change(select, { target: { value: "mainnet" } });
    expect(readSelectedNetwork()).toBe("mainnet");

    unmount();
    render(<NetworkSelector />);
    expect(screen.getByTestId("network-selector")).toHaveValue("mainnet");
  });
});
