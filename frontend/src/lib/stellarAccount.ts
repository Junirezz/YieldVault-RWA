import { getAddress, isAllowed } from "@stellar/freighter-api";
import { Horizon } from "@stellar/stellar-sdk";
import { getHorizonUrlForRpcUrl, networkConfig } from "../config/network";

const USDC_CODE = "USDC";
const USDC_ISSUER = import.meta.env.VITE_USDC_ISSUER;

function isCreditBalance(
  balance: Horizon.HorizonApi.BalanceLine,
): balance is
  | Horizon.HorizonApi.BalanceLineAsset<"credit_alphanum4">
  | Horizon.HorizonApi.BalanceLineAsset<"credit_alphanum12"> {
  return balance.asset_type === "credit_alphanum4" || balance.asset_type === "credit_alphanum12";
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

export async function discoverConnectedAddressWithRetry(
  retries = 5,
  delayMs = 250,
): Promise<string | null> {
  const isVitest =
    typeof process !== "undefined" && process.env.VITEST === "true";
  const effectiveRetries = isVitest ? 1 : retries;

  for (let index = 0; index < effectiveRetries; index += 1) {
    const address = await discoverConnectedAddress();
    if (address) {
      return address;
    }

    if (index < retries - 1) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
    }
  }

  return null;
}

export async function fetchUsdcBalance(
  walletAddress: string,
  rpcUrl = networkConfig.rpcUrl,
): Promise<number> {
  const horizonUrl = getHorizonUrlForRpcUrl(rpcUrl);
  const ServerFactory = Horizon.Server as unknown as {
    new (url: string): {
      accounts: () => { accountId: (id: string) => { call: () => Promise<{ balances: Array<Horizon.HorizonApi.BalanceLine> }> } };
    };
    (url: string): {
      accounts: () => { accountId: (id: string) => { call: () => Promise<{ balances: Array<Horizon.HorizonApi.BalanceLine> }> } };
    };
  };
  const server = (() => {
    try {
      return new ServerFactory(horizonUrl);
    } catch {
      return ServerFactory(horizonUrl);
    }
  })();
  const account = await server.accounts().accountId(walletAddress).call();

  const usdc = account.balances.find((balance) => {
    if (!isCreditBalance(balance)) return false;
    if (balance.asset_code !== USDC_CODE) return false;
    if (USDC_ISSUER && balance.asset_issuer !== USDC_ISSUER) return false;
    return true;
  });

  return usdc ? Number(usdc.balance) : 0;
}

export async function fetchXlmBalance(
  walletAddress: string,
  rpcUrl = networkConfig.rpcUrl,
): Promise<number> {
  const horizonUrl = getHorizonUrlForRpcUrl(rpcUrl);
  const server = new Horizon.Server(horizonUrl);
  const account = await server.accounts().accountId(walletAddress).call();

  const native = account.balances.find((balance) => balance.asset_type === "native");
  return native ? Number(native.balance) : 0;
}

