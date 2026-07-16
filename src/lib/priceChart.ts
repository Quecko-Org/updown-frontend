/**
 * Shared price history parsing and clipping for TradingChart, MarketPriceChart, and home mini sparklines.
 */

import { formatStrikeUsd } from "./format";

export type PricePoint = { t: number; p: number };

/**
 * The value the market chart header shows next to its "Settlement" label for a
 * RESOLVED market.
 *
 * It reads the SAME `settlementPrice` field (through the SAME `formatStrikeUsd`)
 * that the resolved market card reads, so the chart and the card can never show
 * two different settlement prices for one market.
 *
 * Returns "—" while the on-chain settlement price is still syncing
 * (`formatStrikeUsd` → "Pending" for an empty/zero raw). The chart header used
 * to fall back to the last live spot tick in that window, which (a) disagreed
 * with the card's "Settling…" / settled value and (b) mislabeled a spot price
 * as the settlement — the demo scripts settlement to strike×1.005, so the spot
 * and the settlement are legitimately different numbers. QA 2026-07-16:
 * chart showed $64,733.08 (spot) while the card showed $65,033.56 (settlement)
 * for the same market.
 */
export function settlementHeaderLabel(
  settlementPriceRaw: string | undefined | null,
  strikeDecimals?: number,
): string {
  const label = formatStrikeUsd(settlementPriceRaw, strikeDecimals);
  return label === "Pending" ? "—" : label;
}

function parseTimeSec(o: Record<string, unknown>): number | null {
  const tRaw = o.time ?? o.t ?? o.ts ?? o.timestamp;
  if (typeof tRaw === "number" && Number.isFinite(tRaw)) {
    return tRaw > 1e12 ? tRaw / 1000 : tRaw;
  }
  if (typeof tRaw === "string" && tRaw) {
    const n = Number(tRaw);
    if (Number.isFinite(n)) return n > 1e12 ? n / 1000 : n;
  }
  const iso = o.createdAt ?? o.updatedAt;
  if (typeof iso === "string" && iso) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) return ms / 1000;
  }
  return null;
}

function parsePrice(o: Record<string, unknown>): number | null {
  const pRaw = o.currentPrice ?? o.price ?? o.close ?? o.value ?? o.p ?? o.last;
  if (typeof pRaw === "string") {
    const n = Number(pRaw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (typeof pRaw === "number" && Number.isFinite(pRaw) && pRaw > 0) return pRaw;
  return null;
}

function rowToPoint(row: unknown): PricePoint | null {
  if (Array.isArray(row) && row.length >= 2) {
    let t = Number(row[0]);
    const p = Number(row[1]);
    if (!Number.isFinite(t) || !Number.isFinite(p) || p <= 0) return null;
    // API returns ms timestamps (e.g. 1776410340000) — normalize to seconds
    if (t > 1e12) t = t / 1000;
    return { t, p };
  }
  if (row && typeof row === "object") {
    const o = row as Record<string, unknown>;
    const t = parseTimeSec(o);
    const p = parsePrice(o);
    if (t != null && p != null) return { t, p };
  }
  return null;
}

/** Normalize API payload (array or `{ data: [...] }`) to sorted points. */
export function normalizePriceHistoryData(raw: unknown): PricePoint[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const pts = raw.map(rowToPoint).filter((x): x is PricePoint => x !== null);
    pts.sort((a, b) => a.t - b.t);
    return pts;
  }
  if (typeof raw === "object" && raw !== null && "data" in raw) {
    return normalizePriceHistoryData((raw as { data: unknown }).data);
  }
  return [];
}

/** Keep points with t in [startSec, endSec] inclusive. */
export function clipPointsBetween(points: PricePoint[], startSec: number, endSec: number): PricePoint[] {
  return points.filter((pt) => pt.t >= startSec && pt.t <= endSec);
}

/** Last `windowSec` seconds ending at `endAtSec` (e.g. recent action). */
export function clipRecentWindow(points: PricePoint[], endAtSec: number, windowSec: number): PricePoint[] {
  const start = endAtSec - windowSec;
  return points.filter((pt) => pt.t >= start && pt.t <= endAtSec);
}

/**
 * Card mini sparkline: trailing `recentWindowSec` ending at `nowSec`.
 * Params marketStartSec/marketEndSec kept for caller compatibility; sparkline shows trailing window regardless of market boundaries.
 */
export function clipForMarketCard(
  points: PricePoint[],
  marketStartSec: number,
  marketEndSec: number,
  nowSec: number,
  recentWindowSec: number,
): PricePoint[] {
  const lo = nowSec - recentWindowSec;
  const hi = nowSec;
  return points.filter((pt) => pt.t >= lo && pt.t <= hi);
}
