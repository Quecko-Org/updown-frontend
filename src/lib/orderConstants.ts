/**
 * Market-order slippage tolerance.
 *
 * Under PR-O the on-chain Settlement.enterPosition pulls
 * `(order.price * fillAmount) / 10000` from the buyer (Option B cash side).
 * A MARKET order signed with `order.price = 0` makes cashPart 0 and trips
 * the contract's `sellerReceives <= cashPart` guard with
 * `FeeBreakdownInvalid(0x6cebd3e0)` — every market BUY would revert post-
 * deploy. The fix: sign market orders at a worst-acceptable price (best
 * opposite-side ± slippage). The contract uses that as the buyer's
 * cash-side cap; any slippage between the signed cap and the actual
 * match price settles into `marketRetained` as protocol-collected dust.
 *
 * 500 bps = 5%, the Polymarket-equivalent default. Fixed for v1, no UI
 * toggle. If a user complains post-audit, revisit by extending TradeForm
 * with an advanced "max slippage" input wired to this constant's caller.
 */
export const SLIPPAGE_BPS = 500;

/**
 * Compute the worst-acceptable limit price for a MARKET order.
 *
 * BUY  → `bestAsk × (1 + SLIPPAGE_BPS/10000)`, rounded UP (buyer accepts paying more)
 * SELL → `bestBid × (1 − SLIPPAGE_BPS/10000)`, rounded DOWN (seller accepts receiving less)
 *
 * Clamped to the contract's `[1, 9999]` priceBps range. The clamp SATURATES
 * rather than rejects: a BUY whose padded cap lands above 9999 (any best ask
 * ≥ ~9524 bps once × 1.05) just means "pay up to the maximum representable
 * price" — execution still pegs to the resting maker's price, the cap only
 * bounds it. Returning null here instead used to make every high-probability
 * market unbuyable via MARKET: the submit path read null as an empty book and
 * threw "Insufficient liquidity" against a full one (QA 2026-07-22, $290 BUY
 * UP vs a 99.0¢ ask). Mirror case for a SELL pushed below 1 bps.
 *
 * Returns `null` only when `bestPriceBps` itself is null/0/≥10000 — i.e. the
 * relevant side is genuinely empty or quoting at a non-trading price — and the
 * caller should reject with an "Insufficient liquidity" toast.
 */
export function computeMarketSlippagePrice(args: {
  orderSide: 0 | 1; // 0 = BUY, 1 = SELL
  bestPriceBps: number | null | undefined;
  slippageBps?: number;
}): number | null {
  const { orderSide, bestPriceBps } = args;
  const slip = args.slippageBps ?? SLIPPAGE_BPS;
  if (
    bestPriceBps == null ||
    !Number.isFinite(bestPriceBps) ||
    bestPriceBps <= 0 ||
    bestPriceBps >= 10000
  ) {
    return null;
  }
  let priceBps: number;
  if (orderSide === 0) {
    // BUY: raise the price by slippage%, round UP so the worst case is
    // never under-stated. Integer ceil.
    priceBps = Math.ceil((bestPriceBps * (10000 + slip)) / 10000);
  } else {
    // SELL: lower the price by slippage%, round DOWN so the worst case
    // is never over-stated. Integer floor.
    priceBps = Math.floor((bestPriceBps * (10000 - slip)) / 10000);
  }
  // Saturate into [1, 9999] — the contract's representable band. The pad is
  // a tolerance, not a target: capping a BUY at 9999 (or flooring a SELL at
  // 1) keeps the order signable while execution still pegs to the resting
  // maker's price. Rejecting out-of-band results here bricked MARKET BUYs on
  // every book whose best ask was ≥ ~9524 bps.
  return Math.max(1, Math.min(9999, priceBps));
}
