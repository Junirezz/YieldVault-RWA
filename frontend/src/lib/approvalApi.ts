/**
 * USDC allowance approval API.
 *
 * In production this builds and submits a Stellar `approve(spender, amount)`
 * transaction for the connected wallet. Until that integration lands this
 * module performs a simulated on-chain round-trip so the approval flow and its
 * failure handling can be exercised and unit-tested (previously the simulation
 * was inlined in `useTokenAllowance`, leaving its error branch unreachable).
 */

/** Simulated transaction confirmation time, in ms. */
const SIMULATED_TX_DURATION_MS = 1500;

export async function submitUsdcApproval(
  walletAddress: string,
  amount: number,
): Promise<void> {
  if (!walletAddress) {
    throw new Error("A connected wallet is required to approve USDC.");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Approval amount must be a positive number.");
  }

  await new Promise<void>((resolve) => setTimeout(resolve, SIMULATED_TX_DURATION_MS));
}
