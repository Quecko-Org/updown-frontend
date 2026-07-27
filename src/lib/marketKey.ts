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
 * PR-R (2026-05-20) deleted the `/market/<address>` detail route; the home
 * page drawer is the single trade UI surface. This helper produces the
 * home-page deep link (`/?market=<addr>`) that the markets page reads to
 * pre-open the trade drawer for the requested market (switching asset +
 * timeframe to match). Existing callers (Portfolio rows, MarketCard,
 * MarketClosedPanel's "Go to live market" CTA) pass a market address and
 * get back a navigable href instead of landing on the current live market.
 */
export function marketPathFromAddress(address: string): string {
  return `/?market=${address}`;
}
