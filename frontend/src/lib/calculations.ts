/**
 * Calculates the projected earnings for a given deposit amount, APY, and time horizon.
 * Uses daily compounding formula: A = P * (1 + r/n)^(nt)
 * Where:
 * A = the future value of the investment/loan, including interest
 * P = the principal investment amount (deposit amount)
 * r = the annual interest rate (APY as a decimal)
 * n = the number of times that interest is compounded per unit t (365 for daily)
 * t = the time the money is invested for (days / 365)
 * 
 * Simplified for daily compounding over N days:
 * A = P * (1 + APY / 100 / 365) ^ days
 * 
 * @param amount Principal deposit amount
 * @param apy Annual Percentage Yield (e.g., 8.45)
 * @param days Time horizon in days
 * @returns Projected earnings (A - P)
 */
export function calculateProjectedEarnings(
  amount: number,
  apy: number,
  days: number
): number {
  if (amount <= 0 || apy <= 0 || days <= 0) {
    return 0;
  }

  const dailyRate = apy / 100 / 365;
  const futureValue = amount * Math.pow(1 + dailyRate, days);
  
  return futureValue - amount;
}
