/**
 * REST URLs and API paths use a composite key: `{settlementAddress}-{marketId}`
 * (settlement = 42-char 0x-prefixed hex, marketId = decimal).
 * EIP-712 `Order.market` is the numeric marketId (uint256) only — see TradeForm + eip712.
 */

const COMPOSITE_RE = /^(0x[a-fA-F0-9]{40})-(\d+)$/i;

export type ParsedCompositeMarketKey = {
  settlement: `0x${string}`;
  marketId: bigint;
  /** Original composite string (normalized casing for settlement) */
  composite: string;
};

export function parseCompositeMarketKey(raw: string): ParsedCompositeMarketKey | null {
  const trimmed = raw.trim();
  const m = trimmed.match(COMPOSITE_RE);
  if (!m) return null;
  const settlement = m[1].toLowerCase() as `0x${string}`;
  const marketId = BigInt(m[2]);
  return {
    settlement,
    marketId,
    composite: `${settlement}-${m[2]}`,
  };
}

/**
 * PR-R (2026-05-20): the `/market/<address>` detail route is deleted.
 * The home page drawer is the single trade UI surface; this helper now
 * returns "/" so existing callers (Portfolio rows, MarketCard, etc.)
 * still produce valid navigation. Users land on home and select the
 * market from the strip / list.
 *
 * Future: a home-page deep-link query param (e.g., `/?market=<addr>`)
 * that pre-opens the drawer for the requested market would restore the
 * "navigate directly to this market" UX. Deferred — out of PR-R scope.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function marketPathFromAddress(_address: string): string {
  return "/";
}
