it("clears amount and validation errors when switching between tabs", async () => {
  renderDashboard("GABC123", 1250.5);

  const depositTab = screen.getByRole("tab", { name: "Deposit" });
  const withdrawTab = screen.getByRole("tab", { name: "Withdraw" });

  // Enter an amount that exceeds balance on deposit tab and trigger validation
  let input = screen.getByPlaceholderText("0.00");
  fireEvent.change(input, { target: { value: "5000" } });
  fireEvent.blur(input);

  expect(
    screen.getByText(
      /Deposit amount cannot exceed your available USDC balance./i
    )
  ).toBeInTheDocument();

  expect(
    screen.getByRole("button", { name: "Approve & Deposit" })
  ).toBeDisabled();

  // Switch to withdraw tab
  fireEvent.click(withdrawTab);

  // 🔥 Re-query input AFTER tab switch
  input = screen.getByPlaceholderText("0.00");

  // Amount should be cleared
  expect(input).toHaveValue("");

  // Inline errors should NOT appear
  expect(
    screen.queryByText(
      /Deposit amount cannot exceed your available USDC balance./i
    )
  ).not.toBeInTheDocument();

  expect(
    screen.queryByText(
      /The withdrawal amount exceeds your available USDC balance./i
    )
  ).not.toBeInTheDocument();

  // Switch back to deposit tab
  fireEvent.click(depositTab);

  // 🔥 Re-query again
  input = screen.getByPlaceholderText("0.00");

  expect(input).toHaveValue("");

  expect(
    screen.queryByText(
      /Deposit amount cannot exceed your available USDC balance./i
    )
  ).not.toBeInTheDocument();
});
