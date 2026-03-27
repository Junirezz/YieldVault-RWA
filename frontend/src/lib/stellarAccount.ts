import { getAddress, isAllowed } from "@stellar/freighter-api";
import { Horizon } from "@stellar/stellar-sdk";

const TESTNET_SOROBAN_RPC = "soroban-testnet.stellar.org";
const MAINNET_SOROBAN_RPC = "soroban-mainnet.stellar.org";
const TESTNET_HORIZON = "https://horizon-testnet.stellar.org";
const MAINNET_HORIZON = "https://horizon.stellar.org";

const USDC_CODE = "USDC";
const USDC_ISSUER = import.meta.env.VITE_USDC_ISSUER;

function isCreditBalance(
  balance: Horizon.HorizonApi.BalanceLine,
): balance is
  | Horizon.HorizonApi.BalanceLineAsset<"credit_alphanum4">
  | Horizon.HorizonApi.BalanceLineAsset<"credit_alphanum12"> {
  return balance.asset_type === "credit_alphanum4" || balance.asset_type === "credit_alphanum12";
}

function toHorizonUrl(rpcUrl: string): string {
  if (rpcUrl.includes(TESTNET_SOROBAN_RPC)) return TESTNET_HORIZON;
  if (rpcUrl.includes(MAINNET_SOROBAN_RPC)) return MAINNET_HORIZON;
  return import.meta.env.VITE_HORIZON_URL || TESTNET_HORIZON;
}

export async function discoverConnectedAddress(): Promise<string | null> {
  try {
    const allowed = await isAllowed();
    if (!allowed.isAllowed) return null;
    const userInfo = await getAddress();
    return userInfo.address || null;
  } catch {
    return null;
  }
}

export async function fetchUsdcBalance(
  walletAddress: string,
  rpcUrl = import.meta.env.VITE_SOROBAN_RPC_URL || `https://${TESTNET_SOROBAN_RPC}`,
): Promise<number> {
  const horizonUrl = toHorizonUrl(rpcUrl);
  const server = new Horizon.Server(horizonUrl);
  const account = await server.accounts().accountId(walletAddress).call();

  const usdc = account.balances.find((balance) => {
    if (!isCreditBalance(balance)) return false;
    if (balance.asset_code !== USDC_CODE) return false;
    if (USDC_ISSUER && balance.asset_issuer !== USDC_ISSUER) return false;
    return true;
  });

  return usdc ? Number(usdc.balance) : 0;
}
