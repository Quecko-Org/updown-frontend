import { formatUnits, parseUnits } from "viem";

export const USDT_DECIMALS = 6;

export function formatUsdt(raw: string | bigint): string {
  const v = typeof raw === "bigint" ? raw : BigInt(raw || "0");
  const s = formatUnits(v, USDT_DECIMALS);
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (Math.abs(n) >= 1_000_000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 1) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function parseUsdtToAtomic(dollars: string): bigint {
  const normalized = dollars.trim().replace(/,/g, "");
  return parseUnits(normalized || "0", USDT_DECIMALS);
}

/** Compact "$X.XK" USD label for tight surfaces (market cards). Uses K above
 *  $1k, M above $1M, otherwise plain $X. Sub-dollar volumes show as "$0".
 *  Phase2-D: introduced for market-card volume readouts where horizontal
 *  space is limited and exact cents add no value. */
export function formatUsdCompact(raw: string | bigint | undefined | null): string {
  if (raw == null) return "$0";
  try {
    const v = typeof raw === "bigint" ? raw : BigInt(raw || "0");
    const s = formatUnits(v, USDT_DECIMALS);
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return "$0";
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
    if (n >= 1) return `$${Math.round(n)}`;
    return "<$1";
  } catch {
    return "$0";
  }
}

/** Short "$X.XX" USD label from a USDT atomic amount (6 decimals) string or bigint. */
export function fmtUsd(raw: string | bigint | undefined | null): string {
  if (raw == null) return "$0.00";
  try {
    const v = typeof raw === "bigint" ? raw : BigInt(raw || "0");
    const s = formatUnits(v, USDT_DECIMALS);
    const n = Number(s);
    if (!Number.isFinite(n)) return "$0.00";
    return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch {
    return "$0.00";
  }
}

/** Format on-chain probability price (often 18 decimals) for display. */
/** Time left for a market; no raw seconds in the string. */
export function formatTimeRemainingNoSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s === 0) return "Ended";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m} min` : `${h}h`;
  if (m > 0) return `${m} min`;
  return "Less than a minute";
}

export function formatProbabilityPrice(raw: string): string {
  try {
    const v = formatUnits(BigInt(raw), 18);
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return `${(n * 100).toFixed(1)}¢`;
  } catch {
    return "—";
  }
}

/** Legacy AggregatorV3 strike scale (BTC/USD, ETH/USD answer decimals).
 *  Streams-strike markets (post 2026-05-16 contract migration) carry their
 *  own scale via `Market.strikeDecimals` from the API; this constant is the
 *  fallback for historic markets and any old callsite that hasn't been
 *  threaded through with a per-market value yet. */
const STRIKE_USD_DECIMALS_LEGACY = 8;

const strikeUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Strike from API as integer string. `decimals` is the atomic-scale
 *  exponent for that market (`Market.strikeDecimals`). Defaults to 8 so
 *  legacy callers without per-market context still render correctly for
 *  pre-Streams-strike markets. */
export function formatStrikeUsd(
  raw: string | undefined | null,
  decimals: number = STRIKE_USD_DECIMALS_LEGACY,
): string {
  if (raw == null || raw === "") return "Pending";
  try {
    const v = BigInt(raw);
    if (v === BigInt(0)) return "Pending";
    const s = formatUnits(v, decimals);
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return "Pending";
    return strikeUsdFormatter.format(n);
  } catch {
    return "Pending";
  }
}

/** Market duration in seconds → UI label (COWORK timeframes). */
export function marketDurationLabel(durationSec: number): string {
  if (durationSec === 300) return "5 min";
  if (durationSec === 900) return "15 min";
  if (durationSec === 3600) return "1 hour";
  return `${Math.round(durationSec / 60)} min`;
}

/** Strike as USD number for comparisons; null if pending / invalid. See
 *  `formatStrikeUsd` for the `decimals` parameter contract. */
export function parseStrikeUsdNumber(
  raw: string | undefined | null,
  decimals: number = STRIKE_USD_DECIMALS_LEGACY,
): number | null {
  if (raw == null || raw === "") return null;
  try {
    const v = BigInt(raw);
    if (v === BigInt(0)) return null;
    const s = formatUnits(v, decimals);
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  } catch {
    return null;
  }
}

/**
 * Implied probability from pool totals.
 *
 * PR-4 PLACEHOLDER — pool-based prob is correct ONLY at resolution time
 * (when the pool ratio reflects the realized outcome odds). For ACTIVE
 * markets the source-of-truth is the orderbook mid-price (best bid/ask
 * from the DMM) — pool ratios lag and skew with one-sided trading. The
 * orderbook subscription per-market lands in PR-5; until then this
 * helper feeds both ACTIVE and RESOLVED rows, with the known caveat
 * that ACTIVE rows under-react to fresh quoting until the next fill
 * shifts the pool ratio.
 *
 * Inputs `upPoolRaw` / `downPoolRaw` are USDTM atomic-unit decimal
 * strings (6-decimal). For historical reasons the API surfaces these
 * as `upPrice` / `downPrice` on MarketListItem — the naming is wrong
 * and will be cleaned up in the same backend coordination as the
 * orderbook source-of-truth move.
 *
 * Returns null when both pools are zero (no trades have happened, no
 * meaningful probability to render). Callers MUST render `—` or hide
 * the % display on null — rendering 0% would lie to users.
 */
export type ImpliedProb = { upPct: number; downPct: number };

export function computeImpliedProb(
  upPoolRaw: string | undefined | null,
  downPoolRaw: string | undefined | null,
): ImpliedProb | null {
  const ZERO = BigInt(0);
  const parsePool = (raw: string | undefined | null): bigint => {
    if (raw == null || raw === "") return ZERO;
    try {
      return BigInt(raw);
    } catch {
      return ZERO;
    }
  };
  const up = parsePool(upPoolRaw);
  const down = parsePool(downPoolRaw);
  const total = up + down;
  if (total === ZERO) return null;
  // Convert to number for the ratio — pool magnitudes are well within
  // Number precision (USDTM atomic for any realistic prediction-market
  // notional is <2^53). 100ths of a percent is plenty of resolution.
  const upPct = Math.round((Number(up) / Number(total)) * 100);
  const downPct = 100 - upPct;
  return { upPct, downPct };
}
