import React, { useState, useMemo } from "react";
import { Card, Input } from "../ui";
import Skeleton from "../Skeleton";
import { useVault } from "../../context/VaultContext";
import { calculateProjectedEarnings } from "../../lib/calculations";
import { formatCurrency } from "../../lib/formatters";
import "./EarningsCalculator.css";

export const EarningsCalculator: React.FC = () => {
  const { apy, isLoading, formattedApy } = useVault();
  const [amount, setAmount] = useState<number>(1000);
  const [days, setDays] = useState<number>(30);

  const projectedEarnings = useMemo(() => {
    return calculateProjectedEarnings(amount, apy, days);
  }, [amount, apy, days]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setAmount(isNaN(val) ? 0 : val);
  };

  const handleDaysChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setDays(isNaN(val) ? 0 : val);
  };

  return (
    <Card 
      header={<h3 className="calculator-title">Earnings Calculator</h3>}
      className="earnings-calculator-card"
    >
      <div className="calculator-content">
        <div className="calculator-inputs">
          <Input
            label="Deposit Amount"
            type="number"
            value={amount === 0 ? "" : amount}
            onChange={handleAmountChange}
            placeholder="0.00"
            min="0"
            leftIcon={<span className="currency-symbol">$</span>}
            helperText="Amount you plan to deposit"
          />
          <Input
            label="Time Horizon (Days)"
            type="number"
            value={days === 0 ? "" : days}
            onChange={handleDaysChange}
            placeholder="30"
            min="1"
            max="3650"
            rightIcon={<span className="unit-label">Days</span>}
            helperText="How long you'll hold"
          />
        </div>

        <div className="calculator-results" aria-live="polite">
          <div className="result-item">
            <span className="result-label">Current APY</span>
            <span className="result-value highlighted">
              {isLoading ? <Skeleton width="60px" height="1.5rem" /> : formattedApy}
            </span>
          </div>
          <div className="result-item main-result">
            <span className="result-label">Projected Earnings</span>
            <span className="result-value large">
              {isLoading ? (
                <Skeleton width="120px" height="2.5rem" />
              ) : (
                formatCurrency(projectedEarnings)
              )}
            </span>
          </div>
        </div>

        <p className="calculator-disclaimer">
          * Projections are estimates based on current APY and are not guaranteed. 
          Actual returns may vary based on vault performance and network conditions.
        </p>
      </div>
    </Card>
  );
};
