import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import VaultDashboard from "../components/VaultDashboard";
import { VaultProvider } from "../context/VaultContext";
import { ToastProvider } from "../context/ToastContext";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock hooks
vi.mock("../hooks/useVaultMutations", () => ({
  useDepositMutation: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useWithdrawMutation: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

vi.mock("../hooks/useTokenAllowance", () => ({
  useTokenAllowance: () => ({
    approvalStatus: "idle",
    needsApproval: () => false,
    approve: vi.fn(),
    resetApproval: vi.fn(),
  }),
}));

vi.mock("../hooks/useFeeEstimate", () => ({
  useFeeEstimate: () => ({
    feeXlm: 0.1,
    feeUsd: 0.01,
    isEstimating: false,
    isHighFee: false,
  }),
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <BrowserRouter>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <VaultProvider>
          {children}
        </VaultProvider>
      </ToastProvider>
    </QueryClientProvider>
  </BrowserRouter>
);

describe("VaultDashboard Wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("navigates through the deposit wizard steps", async () => {
    render(
      <Wrapper>
        <VaultDashboard walletAddress="GB..." usdcBalance={100} />
      </Wrapper>
    );

    // Step 1: Amount
    expect(screen.getByText("Amount to deposit")).toBeInTheDocument();
    const input = screen.getByLabelText("Deposit amount");
    fireEvent.change(input, { target: { value: "10" } });

    const reviewBtn = screen.getByText("Review Transaction");
    fireEvent.click(reviewBtn);

    // Step 2: Review
    await waitFor(() => {
      expect(screen.getByText("Confirm Transaction")).toBeInTheDocument();
    });
    expect(screen.getByText("10.00 USDC")).toBeInTheDocument();

    const backBtn = screen.getByText("Back");
    fireEvent.click(backBtn);

    // Back to Step 1
    expect(screen.getByText("Amount to deposit")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10")).toBeInTheDocument();

    // Go to Review again
    fireEvent.click(screen.getByText("Review Transaction"));
    
    // Confirm
    const confirmBtn = screen.getByText("Confirm deposit");
    fireEvent.click(confirmBtn);

    // Step 3: Result
    await waitFor(() => {
      expect(screen.getByText("Transaction Successful")).toBeInTheDocument();
    });
    
    const doneBtn = screen.getByText("Done");
    fireEvent.click(doneBtn);

    // Reset to Step 1
    expect(screen.getByText("Amount to deposit")).toBeInTheDocument();
    expect(screen.getByDisplayValue("")).toBeInTheDocument();
  });
});
