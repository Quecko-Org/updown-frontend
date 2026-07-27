import { arbitrum, arbitrumSepolia, type Chain } from "viem/chains";
import { CHAIN_ID } from "@/lib/env";

export const ALCHEMY_API_KEY =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_ALCHEMY_API_KEY?.trim() ?? ""
    : "";

export const platform_chainId = CHAIN_ID;

export const activeChain: Chain = CHAIN_ID === 421614 ? arbitrumSepolia : arbitrum;

/**
 * Block-explorer link for a transaction on the active chain — arbiscan.io on
 * Arbitrum One, sepolia.arbiscan.io on Sepolia. Reads the explorer off the
 * viem chain object so the two never drift apart.
 *
 * Returns null for a missing/blank hash (a fill whose settlement tx hasn't
 * been broadcast yet) or if the chain declares no explorer, so callers render
 * a placeholder instead of a dead link.
 */
export function explorerTxUrl(hash: string | null | undefined): string | null {
  const h = hash?.trim();
  if (!h) return null;
  const base = activeChain.blockExplorers?.default?.url;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/tx/${h}`;
}

/**
 * Faucet ("Get 100 …") visibility.
 *
 * Always on for the real testnet (Sepolia). ALSO switchable on for the
 * mock **demo** stack (Arbitrum One, whose collateral is the publicly
 * mintable MockUSDT and whose backend runs `NODE_ENV != production`, so
 * `POST /test/devmint` is live) via `NEXT_PUBLIC_ENABLE_FAUCET=1`. A real
 * production build (real USDT) leaves the flag unset → button stays hidden,
 * preserving the original Layer-1 safety property.
 */
export const FAUCET_ENABLED: boolean =
  activeChain.id === 421614 ||
  process.env.NEXT_PUBLIC_ENABLE_FAUCET === "1" ||
  process.env.NEXT_PUBLIC_ENABLE_FAUCET === "true";

/** Suffix for the faucet button label — "testnet" on Sepolia, "demo" on the
 *  mock Arbitrum One stack, so the copy never claims "testnet" on a mainnet
 *  chain. */
export const FAUCET_LABEL_SUFFIX: string = activeChain.id === 421614 ? "testnet" : "demo";

/**
 * Complementary matching (MINT / MERGE) UX. When on, the order book and the BUY
 * quote path treat the two option books as one deep book: a DOWN bid @ q shows as a
 * synthetic UP ask @ (10000 − q) and vice-versa, so a BUY UP can fill against DOWN
 * buy-side demand by minting a fresh set (and symmetrically for sells). This must
 * only be enabled against a backend + Settlement that implement `mintMatch`/
 * `mergeMatch` (backend `COMPLEMENTARY_MATCHING_ENABLED=1`); otherwise a taker would
 * quote against synthetic liquidity the engine can't actually cross. Default off →
 * the book renders exactly as before (each column reads only its own bids/asks).
 */
export const COMPLEMENTARY_MATCHING_ENABLED: boolean =
  process.env.NEXT_PUBLIC_COMPLEMENTARY_MATCHING === "1" ||
  process.env.NEXT_PUBLIC_COMPLEMENTARY_MATCHING === "true";

/**
 * USDT symbol for the active chain. Mainnet: "USDT" (the production token
 * at 0xCa4f…25F4). Sepolia: "USDTM" (our throwaway MockUSDT — public mint,
 * 6 decimals, deployed once per dev bring-up). Used everywhere the user
 * sees a token label: DepositModal, WithdrawModal, faq/how-it-works copy,
 * etc. Single source of truth so chain-aware copy never drifts.
 */
export function tokenSymbolForActiveChain(): string {
  return activeChain.id === 421614 ? "USDTM" : "USDT";
}

function buildAlchemyRpc(chainId: number, apiKey: string): string {
  if (!apiKey) {
    return chainId === 421614
      ? "https://sepolia-rollup.arbitrum.io/rpc"
      : "https://arb1.arbitrum.io/rpc";
  }
  const subdomain = chainId === 421614 ? "arb-sepolia" : "arb-mainnet";
  return `https://${subdomain}.g.alchemy.com/v2/${apiKey}`;
}

export const ALCHEMY_RPC_URL = buildAlchemyRpc(CHAIN_ID, ALCHEMY_API_KEY);

// NOTE: a former getSessionExpirySec() lived here returning now+48h. It was DEAD
// CODE and disagreed with the single enforced session TTL — SESSION_TTL_SEC (24h)
// in lib/accountKit.ts, which anchors expiry to createdSec (see effectiveExpirySec).
// Removed rather than repurposed so there is exactly one source of truth for the
// session ceiling; the enforced 24h behaviour is unchanged.

export const SESSION_USDT_ALLOWANCE_BASE_UNITS: bigint = BigInt(
  process.env.NEXT_PUBLIC_SESSION_USDT_ALLOWANCE ?? "10000000000"
);

export const SESSION_GAS_LIMIT: bigint = BigInt(process.env.NEXT_PUBLIC_SESSION_GAS_LIMIT ?? "10000000");
