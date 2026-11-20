/**
 * Utilities for building TransactionSummary from transaction parameters.
 * Used by transaction handlers to construct confirmation modal data.
 */

import type { TransactionSummary } from '../types/transaction';
import {
  UNUSUAL_AMOUNT_THRESHOLD,
  LARGE_WITHDRAWAL_THRESHOLD,
  WITHDRAWAL_TIMELOCK_DURATION_HOURS,
  UNUSUAL_FEE_MULTIPLIER,
  STELLAR_BASE_FEE_XLM,
  TRUSTED_CONTRACT_ADDRESSES,
} from './transactionThresholds';
import { networkConfig } from '../config/network';

interface BuildTransactionSummaryParams {
  actionType: 'deposit' | 'withdraw' | string;
  amount: number;
  asset: string;
  feeXlm: number;
  contractAddress: string;
}

/**
 * Constructs a complete TransactionSummary for the confirmation modal.
 *
 * Pure function: no side effects, same input always produces same output.
 *
 * @param params Transaction details (amount, asset, network, fee, contract)
 * @returns TransactionSummary with all fields populated and unusual values detected
 */
export function buildTransactionSummary(
  params: BuildTransactionSummaryParams
): TransactionSummary {
  const {
    actionType,
    amount,
    asset,
    feeXlm,
    contractAddress,
  } = params;

  // Determine network name
  const networkName = networkConfig.isTestnet
    ? 'Testnet'
    : 'Mainnet';

  // Look up contract name from allowlist
  const contractName = TRUSTED_CONTRACT_ADDRESSES[contractAddress] || null;

  // Detect unusual values
  const isUnusualAmount = amount >= UNUSUAL_AMOUNT_THRESHOLD;
  const isUnusualFee = feeXlm > STELLAR_BASE_FEE_XLM * UNUSUAL_FEE_MULTIPLIER;
  const isUnknownContract = contractName === null;

  // Detect timelock requirements
  const requiresTimelock = actionType === 'withdraw' && amount >= LARGE_WITHDRAWAL_THRESHOLD;
  const timelockDurationHours = requiresTimelock ? WITHDRAWAL_TIMELOCK_DURATION_HOURS : null;

  return {
    amount: `${amount.toFixed(2)} ${asset}`,
    asset,
    network: networkName,
    estimatedFee: `${feeXlm.toFixed(6)} XLM`,
    contractAddress,
    contractName,
    actionType,
    isUnusualAmount,
    isUnusualFee,
    isUnknownContract,
    requiresTimelock,
    timelockDurationHours,
  };
}

interface DepositTransactionParams {
  amount: number;
  feeXlm: number;
  contractAddress: string;
}

/**
 * Helper to build TransactionSummary for deposits.
 */
export function buildDepositSummary(params: DepositTransactionParams): TransactionSummary {
  return buildTransactionSummary({
    actionType: 'deposit',
    amount: params.amount,
    asset: 'USDC',
    feeXlm: params.feeXlm,
    contractAddress: params.contractAddress,
  });
}

interface WithdrawalTransactionParams {
  amount: number;
  feeXlm: number;
  contractAddress: string;
}

/**
 * Helper to build TransactionSummary for withdrawals.
 */
export function buildWithdrawalSummary(params: WithdrawalTransactionParams): TransactionSummary {
  return buildTransactionSummary({
    actionType: 'withdraw',
    amount: params.amount,
    asset: 'USDC',
    feeXlm: params.feeXlm,
    contractAddress: params.contractAddress,
  });
}
