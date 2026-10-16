// src/feeCalculator.ts
import Decimal from 'decimal.js';

const MoneyDecimal = Decimal.clone({ precision: 50 });
const TOKEN_SCALE = new MoneyDecimal(10).pow(7);
const MAX_I128 = new MoneyDecimal('170141183460469231731687303715884105727');
const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

export function parseMoneyAmount(value: unknown): Decimal {
  if (typeof value !== 'string' || !AMOUNT_PATTERN.test(value.trim())) {
    throw new Error('amount must be a plain decimal string');
  }

  const amount = new MoneyDecimal(value.trim());
  if (!amount.isFinite() || amount.lte(0)) {
    throw new Error('amount must be greater than zero');
  }
  if (amount.decimalPlaces() > 7) {
    throw new Error('amount must not exceed 7 decimal places');
  }
  if (amount.times(TOKEN_SCALE).gt(MAX_I128)) {
    throw new Error('amount exceeds the maximum supported value');
  }
  return amount;
}

export function moneyAmountToBaseUnits(value: string): string {
  return parseMoneyAmount(value).times(TOKEN_SCALE).toFixed(0);
}

/**
 * Deterministic fee calculator.
 * Returns a base fee that is stable across runs.
 * The fee is read from the FIXED_BASE_FEE environment variable if present,
 * otherwise it falls back to the historic default of '100'.
 */
export function getDeterministicBaseFee(): string {
  const envFee = process.env.FIXED_BASE_FEE;
  if (envFee) {
    // Base fees are integer stroops and must fit the contract's i128 amount.
    if (!/^\d+$/.test(envFee)) {
      throw new Error('FIXED_BASE_FEE must be a positive integer string');
    }
    const fee = new MoneyDecimal(envFee);
    if (fee.lte(0) || fee.gt(MAX_I128)) {
      throw new Error('FIXED_BASE_FEE must be a positive integer string');
    }
    return envFee;
  }
  // Default base fee used by stellar-sdk when not overridden.
  return '100';
}
