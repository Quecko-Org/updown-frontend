/**
 * Stake bounds — single source of truth for the $1–$500 trading window.
 *
 * Mirrors the backend's `src/lib/stakeBounds.ts`. Both sides of the wire
 * MUST agree on these bounds; if you bump one, bump the other in the
 * same PR.
 *
 * The backend route layer (BUG-S2.1) and the SDK (`MIN_STAKE_ATOMIC` /
 * `MAX_STAKE_ATOMIC`) enforce the same window — the frontend is the
 * first gate so users see a friendly error before signing.
 *
 * ⚠️ The two sides gate DIFFERENT quantities and that is deliberate:
 * the backend bound is on the wire `amount` (a SHARE count / face value),
 * while this gate is on the user's INPUT — a cash budget on BUY, a share
 * count on SELL. A cash budget always converts UP into shares
 * (`shares = cash / price`, price < $1), so a $1 cash gate here sits
 * safely above the backend's $1 face floor at every price.
 *
 * Lowered from $5 → $1 on 2026-07-23 (Polymarket parity, rain QA ask).
 */

/** $1. Anything strictly less is rejected by the disabled-button gate — BUY only. */
export const MIN_STAKE_USDT = 1;
export const MIN_STAKE_ATOMIC = BigInt(1_000_000);

/** $500 USDT. Anything strictly greater is rejected. */
export const MAX_STAKE_USDT = 500;
export const MAX_STAKE_ATOMIC = BigInt(500_000_000);

/**
 * Clamp a candidate stake (atomic USDT) to the trading window AND the
 * caller's available balance. Used by the "Max" quick-add button:
 *   - User has $20 balance → Max fills $20.
 *   - User has $1000 balance → Max fills $500 (the bound).
 */
export function clampStakeAtomic(
  stakeAtomic: bigint,
  availableAtomic: bigint,
): bigint {
  const ceiling = stakeAtomic < availableAtomic ? stakeAtomic : availableAtomic;
  return ceiling > MAX_STAKE_ATOMIC ? MAX_STAKE_ATOMIC : ceiling;
}

/**
 * The "Max" button computes `min(availableBalance, MAX_STAKE_USDT)` and
 * displays the result. Returns the dollar amount as a string suitable for
 * direct input-field assignment (no decimal/format gymnastics — the input
 * accepts any 2dp dollar string).
 */
export function maxStakeForBalance(availableAtomic: bigint): string {
  const cap = availableAtomic < MAX_STAKE_ATOMIC ? availableAtomic : MAX_STAKE_ATOMIC;
  // cap is in atomic USDT (6 decimals). Convert to dollars with 2dp.
  const cents = cap / BigInt(10_000); // total cents
  const dollars = Number(cents) / 100;
  return dollars.toFixed(2);
}

/**
 * True iff the stake (atomic) is within the window for `side`.
 *
 * The minimum is ENTRY-ONLY. On SELL the input is a share count, and a
 * holder left with a sub-$1 position — routine after a partial fill —
 * must still be able to exit; only the ceiling applies there.
 */
export function isStakeInRange(
  stakeAtomic: bigint,
  side: "BUY" | "SELL" = "BUY",
): boolean {
  if (stakeAtomic > MAX_STAKE_ATOMIC) return false;
  if (side === "SELL") return stakeAtomic > BigInt(0);
  return stakeAtomic >= MIN_STAKE_ATOMIC;
}
