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

/** Absolute Unix `expirySec` for new sessions (speed-market `ACTIVE_SESSION_TIME` pattern). */
export function getSessionExpirySec(): number {
  return Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
}
