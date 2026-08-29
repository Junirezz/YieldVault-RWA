import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/Tabs";
import SkipLinks from "../components/SkipLinks";

describe("Keyboard navigation", () => {
  it("tabs through skip links, buttons, and labeled inputs", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <SkipLinks />
        <Button>Deposit</Button>
        <Input label="Amount" />
      </div>,
    );

    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to navigation" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Deposit" })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("Amount")).toHaveFocus();
  });

  it("moves between tabs with arrow keys", async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="deposit">
        <TabsList>
          <TabsTrigger value="deposit">Deposit</TabsTrigger>
          <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
        </TabsList>
        <TabsContent value="deposit">Deposit panel</TabsContent>
        <TabsContent value="withdraw">Withdraw panel</TabsContent>
      </Tabs>,
    );

    const depositTab = screen.getByRole("tab", { name: "Deposit" });
    depositTab.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Withdraw" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Withdraw" })).toHaveAttribute("aria-selected", "true");
  });
});
