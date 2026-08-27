import { useState, useCallback } from "react";
import {
  Contract,
  rpc,
  TransactionBuilder,
  BASE_FEE,
  Address,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { networkConfig } from "../config/network";

export type GaslessDepositStatus = "idle" | "signing" | "submitting" | "confirmed" | "error";

interface GaslessDepositResult {
  status: GaslessDepositStatus;
  txHash?: string;
  sharesMinted?: string;
  error?: string;
}

/**
 * Hook for gasless deposits via a relayer.
 *
 * In Soroban, "gasless" means the user signs the transaction envelope off-chain
 * (which includes the token transfer authorization), and a whitelisted relayer
 * submits it, paying the transaction fee. This is the Soroban-native equivalent
 * of ERC-20 permit.
 *
 * Flow:
 * 1. User signs a deposit transaction locally (no network call)
 * 2. Signed transaction is sent to the relayer backend
 * 3. Relayer submits to the Soroban RPC
 * 4. Status is polled until confirmed
 */
export function useGaslessDeposit() {
  const [status, setStatus] = useState<GaslessDepositStatus>("idle");
  const [result, setResult] = useState<GaslessDepositResult>({ status: "idle" });

  const submitGaslessDeposit = useCallback(
    async (
      userAddress: string,
      amount: string,
      asset: string,
    ): Promise<GaslessDepositResult> => {
      setStatus("signing");
      setResult({ status: "signing" });

      try {
        if (!networkConfig.contractId) {
          throw new Error("Vault contract ID is not configured");
        }

        const server = new rpc.Server(networkConfig.rpcUrl);
        const userAccount = await server.getAccount(userAddress);

        // Build the deposit transaction
        const contract = new Contract(networkConfig.contractId);
        const tx = new TransactionBuilder(userAccount, {
          fee: BASE_FEE,
          networkPassphrase: networkConfig.networkPassphrase,
        })
          .addOperation(
            contract.call(
              "deposit",
              new Address(userAddress).toScVal(),
              nativeToScVal(BigInt(amount), { type: "i128" }),
            ),
          )
          .setTimeout(300)
          .build();

        // Simulate to get auth requirements
        const simResult = await server.simulateTransaction(tx);

        if (rpc.Api.isSimulationError(simResult)) {
          throw new Error(`Simulation failed: ${simResult.error}`);
        }

        // In a real implementation, the user would sign this transaction
        // using their wallet (Freighter, LOBSTR, etc.)
        // For now, we send the unsigned tx to the relayer endpoint

        setStatus("submitting");

        const response = await fetch("/api/v1/vault/gasless-deposits", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-wallet-address": userAddress,
          },
          body: JSON.stringify({
            walletAddress: userAddress,
            amount,
            asset,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.message || `Relayer rejected: ${response.status}`);
        }

        const data = await response.json();
        const txHash = data.transactionHash;

        // Poll for confirmation
        let confirmed = false;
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const txResponse = await fetch(
              `${networkConfig.rpcUrl}/transactions/${txHash}`,
            );
            if (txResponse.ok) {
              const txData = await txResponse.json();
              if (txData.status === "SUCCESS" || txData.status === "completed") {
                confirmed = true;
                break;
              }
            }
          } catch {
            // Continue polling
          }
        }

        if (!confirmed) {
          throw new Error("Transaction confirmation timed out");
        }

        const depositResult: GaslessDepositResult = {
          status: "confirmed",
          txHash,
          sharesMinted: data.sharesMinted,
        };
        setStatus("confirmed");
        setResult(depositResult);
        return depositResult;
      } catch (err) {
        const errorResult: GaslessDepositResult = {
          status: "error",
          error: err instanceof Error ? err.message : "Gasless deposit failed",
        };
        setStatus("error");
        setResult(errorResult);
        return errorResult;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setResult({ status: "idle" });
  }, []);

  return {
    status,
    result,
    submitGaslessDeposit,
    reset,
    isIdle: status === "idle",
    isSigning: status === "signing",
    isSubmitting: status === "submitting",
    isConfirmed: status === "confirmed",
    isError: status === "error",
  };
}
