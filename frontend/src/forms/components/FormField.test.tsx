import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FormField from "./FormField";

describe("FormField", () => {
  it("renders label and input", () => {
    render(<FormField label="Amount" name="amount" value="" onChange={() => {}} />);

    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Amount" })).toBeInTheDocument();
  });

  it("shows error and aria-invalid when error is provided", () => {
    render(
      <FormField
        label="Amount"
        name="amount"
        value=""
        onChange={() => {}}
        error="Amount is required."
      />,
    );

    const input = screen.getByLabelText("Amount");
    const error = screen.getByText("Amount is required.");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "amount-error");
    expect(error).toHaveAttribute("id", "amount-error");
  });

  it("does not render an error element when there is no error", () => {
    render(<FormField label="Amount" name="amount" value="" onChange={() => {}} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
