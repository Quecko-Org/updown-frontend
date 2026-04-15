/**
 * UI-only fee headline: full stack (~1.5%) at balanced prices, scaled down toward 90/10
 * so the estimate reflects how aggressive the book is (see product spec).
 */
export function impliedProbabilityForSide(
  side: 1 | 2,
  upPrice: string,
  downPrice: string
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

/** Weight 1 at p=0.5, lower toward p→0 or p→1 (e.g. 0.36 at 0.1 / 0.9). */
export function probabilityFeeWeight(p: number): number {
  const clamped = Math.min(1, Math.max(0, p));
  return Math.max(0, Math.min(1, 4 * Math.min(clamped, 1 - clamped)));
}

export function probabilityScaledFeePercent(totalBps: number, p: number): number {
  return (totalBps / 10000) * 100 * probabilityFeeWeight(p);
}
