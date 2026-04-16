/** Chain + Alchemy + contracts (matches speed-market `app/config/environment.ts` pattern). */
export const platform_chainId = 42161;

export const ALCHEMY_API_KEY =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_ALCHEMY_API_KEY?.trim() ?? ""
    : "";

export const PAYMASTER_POLICY_ID =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_PAYMASTER_POLICY_ID?.trim() ?? ""
    : "";

export const PAYMASTER_ADDRESS = "0x5492B6624226F393d0813a8f0bc752B6C0521393";

export const ALCHEMY_RPC_URL = ALCHEMY_API_KEY
  ? `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
  : "https://arb1.arbitrum.io/rpc";

/** Environment switch: "development" | "stage" | "production". */
const system_ENV =
  (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_ENV : undefined) ??
  "development";

/** USDT token contract on Arbitrum per environment. */
export let usdt_token: string;

if (system_ENV === "development") {
  usdt_token = "0xCa4f77A38d8552Dd1D5E44e890173921B67725F4";
} else if (system_ENV === "stage") {
  usdt_token = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
} else {
  usdt_token = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
}

/** Absolute Unix `expirySec` for new sessions (speed-market `ACTIVE_SESSION_TIME` pattern). */
export function getSessionExpirySec(): number {
  return Math.floor(Date.now() / 1000) + 60 * 60 * 48;
}

export const SESSION_USDT_ALLOWANCE_BASE_UNITS: bigint = BigInt(
  process.env.NEXT_PUBLIC_SESSION_USDT_ALLOWANCE ?? "10000000000"
);

export const SESSION_GAS_LIMIT: bigint = BigInt(process.env.NEXT_PUBLIC_SESSION_GAS_LIMIT ?? "10000000");
