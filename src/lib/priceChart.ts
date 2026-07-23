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

/**
 * Uniform chart cadence — MIRRORS the backend's `chartGridMs`
 * (`src/lib/priceSeries.ts`). Keep the two in sync: a mismatch is harmless
 * (the resample below is idempotent on an already-uniform series only when
 * the grids agree) but re-introduces the texture cliff this exists to kill.
 */
const CHART_TARGET_POINTS = 1000;
const CHART_GRID_SEC = [1, 5, 60];

export function chartGridSec(windowSec: number): number {
  const ideal = Math.max(1, windowSec) / CHART_TARGET_POINTS;
  for (const g of CHART_GRID_SEC) {
    if (g >= ideal) return g;
  }
  return CHART_GRID_SEC[CHART_GRID_SEC.length - 1]!;
}

/**
 * Collapse a series onto the uniform grid, keeping the LAST sample in each
 * slot.
 *
 * `/prices` already returns a gridded series, so this is a no-op on a fresh
 * fetch. It matters for what happens next: the WS `price_snapshot` handler
 * appends every raw 250ms tick straight into the same react-query cache, so
 * within seconds of opening a market the tail grows a 4-samples-per-second
 * fringe against a 5-second body — the same density cliff, rebuilt on the
 * client. Quantizing here is the one choke point that covers both sources.
 *
 * Last-in-slot rather than the backend's median: the newest tick IS the
 * current spot, and the header reads the final point. The in-flight slot's
 * vertex therefore carries a live price at a timestamp up to one grid width
 * stale — invisible next to the endpoint dot, which glides on its own clock.
 */
export function resampleUniform(
  points: PricePoint[],
  gridSec: number,
  originSec: number,
): PricePoint[] {
  if (gridSec <= 0 || points.length === 0) return points;
  const slots = new Map<number, PricePoint>();
  for (const pt of points) {
    const slot = originSec + Math.floor((pt.t - originSec) / gridSec) * gridSec;
    slots.set(slot, { t: slot, p: pt.p });
  }
  return [...slots.values()].sort((a, b) => a.t - b.t);
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
