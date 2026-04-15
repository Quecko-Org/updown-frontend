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

/** Chainlink BTC/USD / ETH/USD answer decimals */
const STRIKE_USD_DECIMALS = 8;

const strikeUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Strike from API as integer string (8 decimals). */
export function formatStrikeUsd(raw: string | undefined | null): string {
  if (raw == null || raw === "") return "Pending";
  try {
    const v = BigInt(raw);
    if (v === BigInt(0)) return "Pending";
    const s = formatUnits(v, STRIKE_USD_DECIMALS);
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
