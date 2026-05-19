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
 * Clamped to the contract's `[1, 9999]` priceBps range; a result outside
 * that range would either revert on-chain (price=0 → cashPart 0) or be
 * meaningless (price=10000 means "1.00 USDT per share at fill" which is
 * the at-resolution payout, not a trading price).
 *
 * Returns `null` if `bestPriceBps` is null/0/out-of-range — caller should
 * reject the trade with an "Insufficient liquidity" toast in that case
 * rather than signing an unfillable order.
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
  // Clamp to [1, 9999]. Below 1 means the slippage pushed an already-low
  // bid below the contract's minimum representable price.
  if (priceBps < 1 || priceBps > 9999) return null;
  return priceBps;
}
