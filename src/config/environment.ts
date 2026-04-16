/** Chain + Alchemy (matches speed-market `app/config/environment.ts` pattern). */
export const platform_chainId = 42161;

export const ALCHEMY_API_KEY =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_ALCHEMY_API_KEY?.trim() ?? ""
    : "";

export const PAYMASTER_POLICY_ID =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_PAYMASTER_POLICY_ID?.trim() ?? ""
    : "";

export const ALCHEMY_RPC_URL = ALCHEMY_API_KEY
  ? `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
  : "https://arb1.arbitrum.io/rpc";

/** Absolute Unix `expirySec` for new sessions (48h default). */
export function getSessionExpirySec(): number {
  return Math.floor(Date.now() / 1000) + 60 * 60 * 48;
}

export const SESSION_USDT_ALLOWANCE_BASE_UNITS: bigint = BigInt(
  process.env.NEXT_PUBLIC_SESSION_USDT_ALLOWANCE ?? "10000000000"
);

export const SESSION_GAS_LIMIT: bigint = BigInt(process.env.NEXT_PUBLIC_SESSION_GAS_LIMIT ?? "10000000");
