import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import PageTransition from "./PageTransition";
import MotionProvider from "./MotionProvider";

describe("PageTransition", () => {
  it("renders page content inside the motion wrapper", () => {
    render(
      <MemoryRouter>
        <MotionProvider>
          <PageTransition>
            <h1>Vaults</h1>
          </PageTransition>
        </MotionProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Vaults" })).toBeInTheDocument();
  });
});
