/**
 * Shared price history parsing and clipping for TradingChart, MarketPriceChart, and home mini sparklines.
 */

export type PricePoint = { t: number; p: number };

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
    const t = Number(row[0]);
    const p = Number(row[1]);
    if (Number.isFinite(t) && Number.isFinite(p) && p > 0) return { t, p };
    return null;
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
