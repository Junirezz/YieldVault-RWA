import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SubmitButton from "./SubmitButton";

describe("SubmitButton", () => {
  it("shows loading label when loading", () => {
    render(
      <SubmitButton
        loading
        disabled={false}
        label="Submit"
        loadingLabel="Submitting..."
      />,
    );

    expect(screen.getByRole("button", { name: "Submitting..." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
  });

  it("is disabled while loading", () => {
    render(<SubmitButton loading disabled={false} label="Submit" />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("is disabled when disabled prop is true", () => {
    render(<SubmitButton loading={false} disabled label="Submit" />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
