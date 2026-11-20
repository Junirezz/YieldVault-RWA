/**
 * Tests for transaction confirmation builder utilities.
 * Covers summary construction, unusual value detection, and contract mapping.
 */

import { describe, it, expect } from 'vitest';
import {
  buildTransactionSummary,
  buildDepositSummary,
  buildWithdrawalSummary,
} from './transactionConfirmationBuilder';
import {
  UNUSUAL_AMOUNT_THRESHOLD,
  LARGE_WITHDRAWAL_THRESHOLD,
  WITHDRAWAL_TIMELOCK_DURATION_HOURS,
  UNUSUAL_FEE_MULTIPLIER,
  STELLAR_BASE_FEE_XLM,
} from './transactionThresholds';

describe('transactionConfirmationBuilder', () => {
  const contractAddress = 'CBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

  describe('buildTransactionSummary', () => {
    it('constructs complete TransactionSummary', () => {
      const summary = buildTransactionSummary({
        actionType: 'deposit',
        amount: 100,
        asset: 'USDC',
        feeXlm: 0.00001,
        contractAddress,
      });

      expect(summary).toMatchObject({
        actionType: 'deposit',
        amount: '100.00 USDC',
        asset: 'USDC',
        contractAddress,
      });
    });

    it('formats amount with asset symbol', () => {
      const summary = buildTransactionSummary({
        actionType: 'deposit',
        amount: 100.5,
        asset: 'USDC',
        feeXlm: 0.00001,
        contractAddress,
      });

      expect(summary.amount).toBe('100.50 USDC');
    });

    it('formats fee in XLM with high precision', () => {
      const summary = buildTransactionSummary({
        actionType: 'deposit',
        amount: 100,
        asset: 'USDC',
        feeXlm: 0.000001,
        contractAddress,
      });

      expect(summary.estimatedFee).toBe('0.000001 XLM');
    });

    it('detects unusual amounts correctly', () => {
      // Amount below threshold
      const normalSummary = buildTransactionSummary({
        actionType: 'deposit',
        amount: UNUSUAL_AMOUNT_THRESHOLD - 1,
        asset: 'USDC',
        feeXlm: 0.00001,
        contractAddress,
      });
      expect(normalSummary.isUnusualAmount).toBe(false);

      // Amount at threshold
      const thresholdSummary = buildTransactionSummary({
        actionType: 'deposit',
        amount: UNUSUAL_AMOUNT_THRESHOLD,
        asset: 'USDC',
        feeXlm: 0.00001,
        contractAddress,
      });
      expect(thresholdSummary.isUnusualAmount).toBe(true);

      // Amount above threshold
      const unusualSummary = buildTransactionSummary({
        actionType: 'deposit',
        amount: UNUSUAL_AMOUNT_THRESHOLD + 1,
        asset: 'USDC',
        feeXlm: 0.00001,
        contractAddress,
      });
      expect(unusualSummary.isUnusualAmount).toBe(true);
    });

    it('detects unusual fees correctly', () => {
      const baseFeeThreshold = STELLAR_BASE_FEE_XLM * UNUSUAL_FEE_MULTIPLIER;

      // Fee below threshold
      const normalSummary = buildTransactionSummary({
        actionType: 'deposit',
        amount: 100,
        asset: 'USDC',
        feeXlm: baseFeeThreshold - 0.00001,
        contractAddress,
      });
      expect(normalSummary.isUnusualFee).toBe(false);

      // Fee at threshold (not unusual — comparison is strictly greater than)
      const thresholdSummary = buildTransactionSummary({
        actionType: 'deposit',
        amount: 100,
        asset: 'USDC',
        feeXlm: baseFeeThreshold,
        contractAddress,
      });
      expect(thresholdSummary.isUnusualFee).toBe(false);

      // Fee above threshold
      const unusualSummary = buildTransactionSummary({
        actionType: 'deposit',
        amount: 100,
        asset: 'USDC',
        feeXlm: baseFeeThreshold + 0.00001,
        contractAddress,
      });
      expect(unusualSummary.isUnusualFee).toBe(true);
    });

    it('detects unknown contracts', () => {
      const unknownAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

      const summary = buildTransactionSummary({
        actionType: 'deposit',
        amount: 100,
        asset: 'USDC',
        feeXlm: 0.00001,
        contractAddress: unknownAddress,
      });

      expect(summary.isUnknownContract).toBe(true);
      expect(summary.contractName).toBeNull();
    });

    it('determines network name based on config', () => {
      const summary = buildTransactionSummary({
        actionType: 'deposit',
        amount: 100,
        asset: 'USDC',
        feeXlm: 0.00001,
        contractAddress,
      });

      // Network must be one of the valid options
      expect(['Mainnet', 'Testnet', 'Futurenet']).toContain(summary.network);
    });

    it('detects timelock requirements for large withdrawals', () => {
      // Small withdrawal: no timelock
      const smallSummary = buildTransactionSummary({
        actionType: 'withdraw',
        amount: LARGE_WITHDRAWAL_THRESHOLD - 1,
        asset: 'USDC',
        feeXlm: 0.00001,
        contractAddress,
      });
      expect(smallSummary.requiresTimelock).toBe(false);
      expect(smallSummary.timelockDurationHours).toBeNull();

      // Large withdrawal: timelock required
      const largeSummary = buildTransactionSummary({
        actionType: 'withdraw',
        amount: LARGE_WITHDRAWAL_THRESHOLD,
        asset: 'USDC',
        feeXlm: 0.00001,
        contractAddress,
      });
      expect(largeSummary.requiresTimelock).toBe(true);
      expect(largeSummary.timelockDurationHours).toBe(WITHDRAWAL_TIMELOCK_DURATION_HOURS);
    });

    it('does not apply timelock to deposits regardless of amount', () => {
      const largeDepositSummary = buildTransactionSummary({
        actionType: 'deposit',
        amount: LARGE_WITHDRAWAL_THRESHOLD + 10000,
        asset: 'USDC',
        feeXlm: 0.00001,
        contractAddress,
      });
      expect(largeDepositSummary.requiresTimelock).toBe(false);
    });
  });

  describe('buildDepositSummary', () => {
    it('creates summary with deposit actionType', () => {
      const summary = buildDepositSummary({
        amount: 100,
        feeXlm: 0.00001,
        contractAddress,
      });

      expect(summary.actionType).toBe('deposit');
      expect(summary.asset).toBe('USDC');
    });

    it('formats correctly for various amounts', () => {
      const testCases = [
        { amount: 1, expected: '1.00 USDC' },
        { amount: 10.5, expected: '10.50 USDC' },
        { amount: 1000.123, expected: '1000.12 USDC' },
      ];

      testCases.forEach(({ amount, expected }) => {
        const summary = buildDepositSummary({
          amount,
          feeXlm: 0.00001,
          contractAddress,
        });
        expect(summary.amount).toBe(expected);
      });
    });
  });

  describe('buildWithdrawalSummary', () => {
    it('creates summary with withdraw actionType', () => {
      const summary = buildWithdrawalSummary({
        amount: 100,
        feeXlm: 0.00001,
        contractAddress,
      });

      expect(summary.actionType).toBe('withdraw');
      expect(summary.asset).toBe('USDC');
    });

    it('formats correctly for various amounts', () => {
      const testCases = [
        { amount: 1, expected: '1.00 USDC' },
        { amount: 10.5, expected: '10.50 USDC' },
        { amount: 1000.123, expected: '1000.12 USDC' },
      ];

      testCases.forEach(({ amount, expected }) => {
        const summary = buildWithdrawalSummary({
          amount,
          feeXlm: 0.00001,
          contractAddress,
        });
        expect(summary.amount).toBe(expected);
      });
    });
  });

  describe('edge cases', () => {
    it('handles very small fees', () => {
      const summary = buildTransactionSummary({
        actionType: 'deposit',
        amount: 100,
        asset: 'USDC',
        feeXlm: 0.00000001,
        contractAddress,
      });

      expect(summary.estimatedFee).toBe('0.000000 XLM');
    });

    it('handles very large amounts', () => {
      const summary = buildTransactionSummary({
        actionType: 'deposit',
        amount: 1000000,
        asset: 'USDC',
        feeXlm: 0.00001,
        contractAddress,
      });

      expect(summary.amount).toBe('1000000.00 USDC');
      expect(summary.isUnusualAmount).toBe(true);
    });

    it('handles zero amount', () => {
      const summary = buildTransactionSummary({
        actionType: 'deposit',
        amount: 0,
        asset: 'USDC',
        feeXlm: 0.00001,
        contractAddress,
      });

      expect(summary.amount).toBe('0.00 USDC');
      expect(summary.isUnusualAmount).toBe(false);
    });

    it('is a pure function', () => {
      const input = {
        actionType: 'deposit' as const,
        amount: 100,
        asset: 'USDC',
        feeXlm: 0.00001,
        contractAddress,
      };

      const result1 = buildTransactionSummary(input);
      const result2 = buildTransactionSummary(input);

      expect(result1).toEqual(result2);
    });
  });

  describe('type safety', () => {
    it('accepts valid actionTypes', () => {
      const validActions: Array<'deposit' | 'withdraw' | string> = [
        'deposit',
        'withdraw',
        'custom-action',
      ];

      validActions.forEach((action) => {
        const summary = buildTransactionSummary({
          actionType: action,
          amount: 100,
          asset: 'USDC',
          feeXlm: 0.00001,
          contractAddress,
        });
        expect(summary.actionType).toBe(action);
      });
    });
  });
});
