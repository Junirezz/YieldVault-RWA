import { useMutation, useQueryClient } from "@tanstack/react-query";
import { submitDeposit, submitWithdrawal } from "../lib/vaultApi";
import {
  applyOptimisticVaultPatch,
  cancelVaultOptimisticQueries,
  captureVaultOptimisticSnapshot,
  invalidateVaultOptimisticQueries,
  rollbackVaultOptimisticSnapshot,
  type VaultOptimisticSnapshot,
} from "../lib/optimisticVaultCache";

interface MutationParams {
  walletAddress: string;
  amount: number;
  referralCode?: string;
  idempotencyKey?: string;
}

/**
 * Deposit mutation with production-hardened optimistic UI cache updates.
 *
 * Flow:
 * 1. Cancel in-flight reads for related keys
 * 2. Snapshot cache (including "never cached" vs "cached")
 * 3. Apply optimistic wallet/holdings/TVL/tx patches
 * 4. On failure: restore snapshot exactly, then invalidate to reconcile
 * 5. On success: invalidate so server truth replaces optimistic rows
 */
export function useDepositMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ walletAddress, amount, referralCode, idempotencyKey }: MutationParams) => {
      await submitDeposit(
        {
          walletAddress,
          amount: amount.toString(),
          asset: "USDC",
          referralCode,
        },
        { idempotencyKey },
      );
      return { walletAddress, amount, referralCode, idempotencyKey };
    },
    onMutate: async ({ walletAddress, amount }): Promise<VaultOptimisticSnapshot> => {
      await cancelVaultOptimisticQueries(queryClient, walletAddress);
      const snapshot = captureVaultOptimisticSnapshot(queryClient, walletAddress);
      applyOptimisticVaultPatch(queryClient, walletAddress, "deposit", amount);
      return snapshot;
    },
    onError: (_error, variables, snapshot) => {
      rollbackVaultOptimisticSnapshot(queryClient, variables.walletAddress, snapshot);
    },
    onSettled: (_data, _error, variables) => {
      invalidateVaultOptimisticQueries(queryClient, variables.walletAddress);
    },
  });
}

/**
 * Withdrawal mutation with production-hardened optimistic UI cache updates.
 *
 * Wallet USDC increases and vault holdings/TVL decrease immediately; any
 * failure restores the pre-mutation snapshot and reconciles via invalidation.
 */
export function useWithdrawMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ walletAddress, amount, idempotencyKey }: MutationParams) => {
      await submitWithdrawal(
        {
          walletAddress,
          amount: amount.toString(),
          asset: "USDC",
        },
        { idempotencyKey },
      );
      return { walletAddress, amount, idempotencyKey };
    },
    onMutate: async ({ walletAddress, amount }): Promise<VaultOptimisticSnapshot> => {
      await cancelVaultOptimisticQueries(queryClient, walletAddress);
      const snapshot = captureVaultOptimisticSnapshot(queryClient, walletAddress);
      applyOptimisticVaultPatch(queryClient, walletAddress, "withdrawal", amount);
      return snapshot;
    },
    onError: (_error, variables, snapshot) => {
      rollbackVaultOptimisticSnapshot(queryClient, variables.walletAddress, snapshot);
    },
    onSettled: (_data, _error, variables) => {
      invalidateVaultOptimisticQueries(queryClient, variables.walletAddress);
    },
  });
}
