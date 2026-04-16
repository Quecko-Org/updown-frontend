/**
 * Fee UI aligned with backend: probability-weighted total fee (Polymarket-style).
 * weight = 4 * p * (1 - p) with p = share price in 0..1 (priceBps / 10000).
 * Integer form: weightNumerator = 4 * priceBps * (10000 - priceBps); scale 10000^2.
 */

const BPS_SCALE = 10_000;

/** Scaled weight numerator; max 4 * 5000 * 5000 = 100_000_000 at 50¢. */
export function probabilityWeightNumerator(priceBps: number): number {
  const pb = Math.min(BPS_SCALE, Math.max(0, Math.floor(priceBps)));
  return 4 * pb * (BPS_SCALE - pb);
}

/** Dimensionless weight in (0,1], equals 4*p*(1-p). */
export function probabilityFeeWeightFromPriceBps(priceBps: number): number {
  return probabilityWeightNumerator(priceBps) / (BPS_SCALE * BPS_SCALE);
}

/** Effective total fee bps after probability weighting (platform + maker combined). */
export function effectiveFeeBpsAtSharePrice(totalFeeBps: number, sharePriceBps: number): number {
  const w = probabilityWeightNumerator(sharePriceBps);
  return Math.floor((totalFeeBps * w) / (BPS_SCALE * BPS_SCALE));
}

export type FeeModelId = string | undefined;

/**
 * Fee in USD on notional. Uses weighted bps when feeModel is probability-weighted (or unset).
 * Otherwise flat totalFeeBps on notional (legacy).
 */
export function estimateTotalFee(
  notionalUsd: number,
  totalFeeBps: number,
  sharePriceBps: number,
  feeModel: FeeModelId,
): { feeUsd: number; effectiveFeeBps: number; effectivePercentOfNotional: number } {
  const useWeighted = feeModel == null || feeModel === "probability-weighted";
  const effectiveFeeBps = useWeighted
    ? effectiveFeeBpsAtSharePrice(totalFeeBps, sharePriceBps)
    : Math.max(0, Math.floor(totalFeeBps));
  const feeUsd = (notionalUsd * effectiveFeeBps) / BPS_SCALE;
  const effectivePercentOfNotional =
    notionalUsd > 0 && Number.isFinite(notionalUsd) ? (feeUsd / notionalUsd) * 100 : 0;
  return { feeUsd, effectiveFeeBps, effectivePercentOfNotional };
}

/** Mid of best bid/ask for the outcome book in bps (1–9999); 5000 = 50¢ if empty. */
export function sharePriceBpsFromOrderBookMid(
  side: 1 | 2,
  orderBook: {
    up: { bestBid: { price: number } | null; bestAsk: { price: number } | null };
    down: { bestBid: { price: number } | null; bestAsk: { price: number } | null };
  },
): number {
  const ob = side === 1 ? orderBook.up : orderBook.down;
  const bid = ob.bestBid?.price;
  const ask = ob.bestAsk?.price;
  if (bid != null && ask != null) return Math.round((bid + ask) / 2);
  if (ask != null) return ask;
  if (bid != null) return bid;
  return 5000;
}

/** Implied UP share price in bps from on-chain probability weights (list view, no order book). */
/** Display label for share price in cents (3000 → "30¢"). */
export function formatShareCentsLabel(priceBps: number): string {
  const c = priceBps / 100;
  if (Number.isInteger(c)) return `${c}¢`;
  return `${c.toFixed(1)}¢`;
}

export function sharePriceBpsFromImpliedUp(upPriceWei: string, downPriceWei: string): number {
  try {
    const up = BigInt(upPriceWei);
    const down = BigInt(downPriceWei);
    const sum = up + down;
    if (sum === BigInt(0)) return 5000;
    return Number((up * BigInt(BPS_SCALE)) / sum);
  } catch {
    return 5000;
  }
}

/** @deprecated use estimateTotalFee + probabilityFeeWeightFromPriceBps */
export function impliedProbabilityForSide(
  side: 1 | 2,
  upPrice: string,
  downPrice: string,
): number {
  try {
    const up = Number(BigInt(upPrice)) / 1e18;
    const down = Number(BigInt(downPrice)) / 1e18;
    if (!Number.isFinite(up) || !Number.isFinite(down)) return 0.5;
    const sum = up + down;
    if (sum <= 0) return 0.5;
    return side === 1 ? up / sum : down / sum;
  } catch {
    return 0.5;
  }
}

/** @deprecated use estimateTotalFee */
export function probabilityFeeWeight(p: number): number {
  const clamped = Math.min(1, Math.max(0, p));
  return Math.max(0, Math.min(1, 4 * Math.min(clamped, 1 - clamped)));
}

/** @deprecated use estimateTotalFee */
export function probabilityScaledFeePercent(totalBps: number, p: number): number {
  return (totalBps / BPS_SCALE) * 100 * probabilityFeeWeight(p);
}
