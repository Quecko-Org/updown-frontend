/**
 * Order-book walking + slippage primitives for the trade form (PR-18).
 *
 * Three pure helpers, BigInt-only math (no floats touch price/depth):
 *
 *   - usdToShares: convert a stake (atomic USDT) to shares received at a
 *     given price, floor-divided so actualCost ≤ stakeUsd always.
 *   - walkBookForAvgFillPrice: walk one side of the order book (pre-sorted
 *     asks ascending OR bids descending) accumulating fillable depth until
 *     stakeAtomic is satisfied. Returns the volume-weighted-average fill
 *     price for the portion that fills. Used by MARKET-order button-price
 *     display (P0-19) instead of the misleading midpoint.
 *   - slippageDecision: at submit-time, compares the freshly-recomputed
 *     fill price to the displayed-at-render price and returns 'silent'
 *     (proceed without prompting) or 'prompt' (ask the user). Adverse-only:
 *     favorable price moves never prompt; adverse moves prompt only above
 *     the threshold (default 1¢ per the PR-18 decision log).
 *
 * No DOM/React dependencies. Trivially unit-testable in isolation.
 *
 * Implementation note: tsconfig target is ES2017 so we use `BigInt(N)`
 * constructor calls instead of `Nn` literal suffix. Behavior identical.
 */

const ZERO = BigInt(0);
const TEN_K = BigInt(10_000);

/** A single price-depth rung from the order-book API. */
export type BookLevel = {
  /** Price in basis points, range 1..9999 (≈ 0.01¢ .. 99.99¢). */
  price: number;
  /** Atomic-USDT depth available at this price as a string (BigInt-able). */
  depth: string;
  /** Order count at this level — informational only, not used in math. */
  count?: number;
};

/** Result of walking the book for a stake. */
export type WalkResult = {
  /**
   * Volume-weighted-average fill price in bps for the portion that fills.
   * `null` only when the requested side is empty (no levels, or all levels
   * have zero depth).
   */
  avgPriceBps: bigint | null;
  /** How much of `stakeAtomic` actually fills (≤ stakeAtomic). */
  fillableAtomic: bigint;
  /** True when fillableAtomic < stakeAtomic — caller should disable submit. */
  requiresMoreDepth: boolean;
};

/**
 * Floor-divide stake → shares at the given price.
 *
 * Math: `shares = (stakeAtomic × 10_000) / priceBps`. The `10_000` factor
 * cancels the bps scale so the result is in atomic-USDT units (which IS
 * shares units in our model — `Order.amount` carries atomic-USDT-stake,
 * the matching engine treats it as shares 1:1 because each winning share
 * pays $1; see PR-18 design §5 / TRACKING decisions log 2026-05-03 for
 * the wire-shape divergence note from Polymarket).
 *
 * Rounding: floor (BigInt `/`). Sub-atomic dust rounds toward the
 * protocol, never toward the user — preserves the invariant
 * `actualCost ≤ stakeUsd`.
 */
export function usdToShares(stakeAtomic: bigint, priceBps: bigint): bigint {
  if (priceBps <= ZERO) return ZERO;
  if (stakeAtomic <= ZERO) return ZERO;
  return (stakeAtomic * TEN_K) / priceBps;
}

/**
 * Walk pre-sorted levels accumulating fillable depth until `stakeAtomic`
 * is satisfied. Returns the VWAP for the filled portion.
 *
 * Caller is responsible for passing levels in the correct order:
 *   - For BUY (taker hits asks):  asks ascending price.
 *   - For SELL (taker hits bids): bids descending price.
 * The backend's /orderbook endpoint already returns asks ascending and
 * bids descending — pass them through directly.
 *
 * Edge cases:
 *   - Empty levels: avgPriceBps = null, fillableAtomic = 0, requiresMoreDepth = (stake > 0).
 *   - Stake within top-of-book depth: avgPriceBps = top.price, full fill.
 *   - Stake walks N levels: weighted avg over filled depth at each level.
 *   - Stake exceeds total depth: avg over what's available, requiresMoreDepth = true.
 */
export function walkBookForAvgFillPrice(
  levels: readonly BookLevel[],
  stakeAtomic: bigint,
): WalkResult {
  if (levels.length === 0) {
    return {
      avgPriceBps: null,
      fillableAtomic: ZERO,
      requiresMoreDepth: stakeAtomic > ZERO,
    };
  }
  if (stakeAtomic <= ZERO) {
    return { avgPriceBps: null, fillableAtomic: ZERO, requiresMoreDepth: false };
  }
  let remaining = stakeAtomic;
  // Σ(priceBps × depthFilledAtThisLevel) — both factors fit BigInt.
  let weightedSum = ZERO;
  let totalFilled = ZERO;
  for (const level of levels) {
    if (remaining === ZERO) break;
    let levelDepth: bigint;
    try {
      levelDepth = BigInt(level.depth);
    } catch {
      // Malformed level — skip gracefully. Backend should never emit
      // this; defensive against future schema drift.
      continue;
    }
    if (levelDepth <= ZERO) continue;
    const fillAtLevel = remaining < levelDepth ? remaining : levelDepth;
    weightedSum += BigInt(level.price) * fillAtLevel;
    totalFilled += fillAtLevel;
    remaining -= fillAtLevel;
  }
  return {
    avgPriceBps: totalFilled === ZERO ? null : weightedSum / totalFilled,
    fillableAtomic: totalFilled,
    requiresMoreDepth: totalFilled < stakeAtomic,
  };
}

/** Slippage decision states. */
export type SlippageDecision = "silent" | "prompt";

/**
 * Decide whether a price move between render-time and submit-time
 * warrants prompting the user.
 *
 * Adverse-only: favorable price moves never prompt (the user gets a
 * better deal — silent acceptance is the right default). Adverse moves
 * within the threshold are also silent (small drift is normal). Adverse
 * moves above the threshold prompt.
 *
 * Direction by `orderSide`:
 *   - BUY  (orderSide=0): price up = adverse (paying more per share).
 *   - SELL (orderSide=1): price down = adverse (receiving less per share).
 *
 * For LIMIT/POST_ONLY/IOC the caller should not invoke this — the user's
 * limit price doesn't move under them. Always-silent for non-MARKET.
 */
export function slippageDecision(
  displayedPriceBps: bigint,
  currentPriceBps: bigint,
  orderSide: 0 | 1, // 0 = BUY, 1 = SELL
  thresholdBps: bigint,
): SlippageDecision {
  const diff = currentPriceBps - displayedPriceBps;
  let isAdverse: boolean;
  if (orderSide === 0) {
    // BUY adverse when price rose (paying more).
    isAdverse = diff > ZERO;
  } else {
    // SELL adverse when price fell (receiving less).
    isAdverse = diff < ZERO;
  }
  if (!isAdverse) return "silent";
  const absDiff = diff < ZERO ? -diff : diff;
  return absDiff > thresholdBps ? "prompt" : "silent";
}
