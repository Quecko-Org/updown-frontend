export const API_BASE =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://dev-api.pulsepairs.com")
    : (process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://dev-api.pulsepairs.com");

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "42161");

/**
 * Option C — non-custodial scoped-session flow. When on, the grant ceremony
 * generates a non-extractable P-256 keypair in IndexedDB, passes the public
 * key as the session signer to grantPermissions, and the WS client signs
 * each settlement UserOp interactively via `sessionSign:<wallet>`. Default
 * OFF; flip to "1" on dev when the backend's `OPTION_C_ENABLED` is also 1.
 * Prod stays off until PR C sunsets Option B entirely.
 */
export const OPTION_C_ENABLED =
  (process.env.NEXT_PUBLIC_OPTION_C_ENABLED ?? "") === "1";

export function wsStreamUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://dev-api.pulsepairs.com";
  const u = new URL(base);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/stream";
  u.search = "";
  u.hash = "";
  return u.toString();
}
